import vm from 'node:vm';
import { Buffer } from 'node:buffer';
import { createHash, createHmac, randomUUID, webcrypto } from 'node:crypto';

import { expect } from './assert.js';
import { clearCookies, getCookies, setCookie } from './cookies.js';
import { rowsToObject, sendRequest } from './http.js';

const SCRIPT_TIMEOUT_MS = 15_000;

function objectToRows(obj) {
  return Object.entries(obj ?? {}).map(([key, value]) => ({
    key,
    value: value === null || value === undefined ? '' : String(value),
    enabled: true,
  }));
}

/** The request shape scripts see: plain objects, easy to mutate. */
function toScriptRequest(request) {
  return {
    method: request.method ?? 'GET',
    url: request.url ?? '',
    headers: rowsToObject(request.headers),
    params: rowsToObject(request.params),
    auth: request.auth ? { ...request.auth } : { type: 'none' },
    body: {
      mode: request.body?.mode ?? 'none',
      raw: request.body?.raw ?? '',
      language: request.body?.language ?? 'json',
      urlencoded: rowsToObject(request.body?.urlencoded),
      formdata: rowsToObject(request.body?.formdata),
    },
  };
}

/** Convert the script's view back into the row shape the sender expects. */
function fromScriptRequest(scriptRequest) {
  return {
    method: scriptRequest.method,
    url: scriptRequest.url,
    headers: objectToRows(scriptRequest.headers),
    params: objectToRows(scriptRequest.params),
    auth: scriptRequest.auth,
    body: {
      mode: scriptRequest.body?.mode ?? 'none',
      raw: scriptRequest.body?.raw ?? '',
      language: scriptRequest.body?.language ?? 'json',
      urlencoded: objectToRows(scriptRequest.body?.urlencoded),
      formdata: objectToRows(scriptRequest.body?.formdata),
    },
  };
}

function serialiseLogArg(arg) {
  if (typeof arg === 'string') return arg;
  if (arg instanceof Error) return `${arg.name}: ${arg.message}`;
  try {
    return JSON.stringify(arg, null, 2) ?? String(arg);
  } catch {
    return String(arg);
  }
}

/** A mutable variable scope exposed to scripts (`pg.environment`, `pg.globals`). */
function makeScope(initial) {
  const values = { ...initial };
  return {
    values,
    api: {
      get: (key) => values[key],
      set: (key, value) => {
        values[key] = value === null || value === undefined ? '' : String(value);
      },
      unset: (key) => {
        delete values[key];
      },
      has: (key) => Object.hasOwn(values, key),
      clear: () => {
        for (const key of Object.keys(values)) delete values[key];
      },
      toObject: () => ({ ...values }),
    },
  };
}

function makeResponseApi(response) {
  if (!response) return null;
  const api = {
    status: response.status,
    code: response.status,
    statusText: response.statusText,
    headers: response.headers ?? {},
    body: response.body ?? '',
    responseTime: response.time,
    time: response.time,
    size: response.size,
    url: response.url,
    text: () => response.body ?? '',
    json: () => JSON.parse(response.body ?? ''),
    /** Safe variant — returns undefined instead of throwing on bad JSON. */
    tryJson: () => {
      try {
        return JSON.parse(response.body ?? '');
      } catch {
        return undefined;
      }
    },
    header: (name) => {
      const key = Object.keys(response.headers ?? {}).find(
        (h) => h.toLowerCase() === String(name).toLowerCase(),
      );
      return key ? response.headers[key] : undefined;
    },
  };
  return api;
}

/**
 * Run a user script in an isolated VM context.
 *
 * This is a *sandbox for convenience, not for security* — Postguy runs on the
 * user's own machine and scripts are written by the same person driving the UI.
 * The timeout and the trimmed-down global surface exist to stop accidental
 * runaway loops, not a determined attacker.
 */
export async function runScript({
  code,
  phase,
  request,
  response = null,
  environment = {},
  globals = {},
  requestName = 'request',
}) {
  const logs = [];
  const tests = [];
  const pendingTests = [];

  const env = makeScope(environment);
  const glob = makeScope(globals);
  const scriptRequest = toScriptRequest(request);
  const control = { skipRequest: false };

  if (!code || !code.trim()) {
    return {
      ran: false,
      logs,
      tests,
      environment: env.values,
      globals: glob.values,
      request: fromScriptRequest(scriptRequest),
      skipRequest: false,
    };
  }

  const log = (level) => (...args) => {
    logs.push({ level, phase, message: args.map(serialiseLogArg).join(' '), ts: Date.now() });
  };

  const consoleApi = {
    log: log('log'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    debug: log('debug'),
  };

  const runTest = (name, fn) => {
    const started = Date.now();
    const record = (passed, error) => {
      tests.push({
        name: String(name),
        passed,
        error: error ? `${error.name === 'AssertionError' ? '' : `${error.name}: `}${error.message}` : null,
        duration: Date.now() - started,
        phase,
      });
    };
    try {
      const result = fn();
      if (result && typeof result.then === 'function') {
        pendingTests.push(
          result.then(
            () => record(true, null),
            (err) => record(false, err),
          ),
        );
        return;
      }
      record(true, null);
    } catch (err) {
      record(false, err);
    }
  };

  const variablesApi = {
    get: (key) => (Object.hasOwn(env.values, key) ? env.values[key] : glob.values[key]),
    set: (key, value) => env.api.set(key, value),
    has: (key) => Object.hasOwn(env.values, key) || Object.hasOwn(glob.values, key),
    replaceIn: (template) =>
      String(template).replace(/\{\{\s*([^{}\s]+)\s*\}\}/g, (match, name) => {
        const value = Object.hasOwn(env.values, name) ? env.values[name] : glob.values[name];
        return value === undefined ? match : String(value);
      }),
    toObject: () => ({ ...glob.values, ...env.values }),
  };

  const utils = {
    uuid: () => randomUUID(),
    now: () => Date.now(),
    timestamp: () => Math.floor(Date.now() / 1000),
    isoNow: () => new Date().toISOString(),
    randomInt: (min = 0, max = 100) => Math.floor(Math.random() * (max - min + 1)) + min,
    base64Encode: (input) => Buffer.from(String(input), 'utf8').toString('base64'),
    base64Decode: (input) => Buffer.from(String(input), 'base64').toString('utf8'),
    hash: (algorithm, data, encoding = 'hex') =>
      createHash(algorithm).update(String(data)).digest(encoding),
    hmac: (algorithm, key, data, encoding = 'hex') =>
      createHmac(algorithm, String(key)).update(String(data)).digest(encoding),
    sleep: (ms) => new Promise((resolve) => setTimeout(resolve, Math.min(Number(ms) || 0, 5000))),
  };

  const pg = {
    info: { phase, requestName, eventName: phase === 'pre' ? 'prerequest' : 'test' },
    request: scriptRequest,
    response: makeResponseApi(response),
    environment: env.api,
    env: env.api,
    globals: glob.api,
    variables: variablesApi,
    test: runTest,
    expect,
    console: consoleApi,
    utils,
    /** Fire an extra HTTP call from inside a script — request chaining. */
    sendRequest: async (input) => {
      const req =
        typeof input === 'string'
          ? { method: 'GET', url: input }
          : {
              method: input.method ?? 'GET',
              url: input.url,
              headers: Array.isArray(input.headers) ? input.headers : objectToRows(input.headers),
              params: Array.isArray(input.params) ? input.params : objectToRows(input.params),
              auth: input.auth,
              body: input.body,
            };
      const result = await sendRequest(req);
      if (result.error) throw new Error(result.error);
      return makeResponseApi(result);
    },
    execution: {
      skipRequest: () => {
        control.skipRequest = true;
      },
    },
    /** The shared cookie jar — read the session a login just established. */
    cookies: {
      all: () => getCookies(),
      get: async (name, domain) => {
        const jar = await getCookies();
        const found = jar.find(
          (cookie) => cookie.name === name && (!domain || cookie.domain === domain),
        );
        return found?.value;
      },
      set: (cookie) => setCookie(cookie),
      clear: (domain) => clearCookies(domain),
    },
  };

  const sandbox = {
    pg,
    // Postman muscle memory: `pm` is an alias for `pg`.
    pm: pg,
    console: consoleApi,
    expect,
    fetch,
    crypto: webcrypto,
    Buffer,
    URL,
    URLSearchParams,
    TextEncoder,
    TextDecoder,
    FormData,
    Headers,
    AbortController,
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    btoa: (s) => Buffer.from(String(s), 'binary').toString('base64'),
    atob: (s) => Buffer.from(String(s), 'base64').toString('binary'),
  };
  sandbox.globalThis = sandbox;

  const context = vm.createContext(sandbox, { name: `postguy:${phase}` });
  const wrapped = `(async () => {\n${code}\n})()`;

  let error = null;
  try {
    const script = new vm.Script(wrapped, { filename: `${phase}-request-script.js` });
    const promise = script.runInContext(context, { timeout: SCRIPT_TIMEOUT_MS });

    let timer;
    const guard = new Promise((_, reject) => {
      timer = setTimeout(
        () => reject(new Error(`Script exceeded ${SCRIPT_TIMEOUT_MS / 1000}s time limit`)),
        SCRIPT_TIMEOUT_MS,
      );
    });
    try {
      await Promise.race([Promise.resolve(promise), guard]);
      await Promise.race([Promise.allSettled(pendingTests), guard]);
    } finally {
      clearTimeout(timer);
    }
  } catch (err) {
    error = `${err.name}: ${err.message}`;
    logs.push({ level: 'error', phase, message: error, ts: Date.now() });
  }

  return {
    ran: true,
    logs,
    tests,
    error,
    environment: env.values,
    globals: glob.values,
    request: fromScriptRequest(scriptRequest),
    skipRequest: control.skipRequest,
  };
}
