import { EventEmitter } from 'node:events';
import vm from 'node:vm';
import { Buffer } from 'node:buffer';
import { randomUUID, webcrypto } from 'node:crypto';

import { expect } from './assert.js';
import { clearCookies, getCookies, setCookie } from './cookies.js';
import { sendRequest } from './http.js';
import { makeUtils, serialiseLogArg } from './scripting.js';

/**
 * Background job runner.
 *
 * A job is one script run N times. The runner owns the loop — how many
 * iterations, how many at once, and how long to wait between them — so the
 * script only has to describe a single iteration.
 *
 *   concurrency 1 + interval 15s  → the classic slow poller
 *   concurrency 5 + interval 0    → turbo
 *
 * Jobs live in memory and keep running whether or not a browser is watching;
 * the UI attaches and detaches from the event stream at will.
 */

const MAX_LOGS = 2000;
const MAX_ROWS = 5000;
const MAX_REQUESTS = 300;
const MAX_BODY_CHARS = 64 * 1024; // per stored response, so a long job can't eat the heap
const SYNC_TIMEOUT_MS = 10_000; // guards `while (true)` with no await in it
const DEFAULT_MAX_RUNTIME_MS = 12 * 60 * 60 * 1000;

const jobs = new Map();

function push(list, item, cap) {
  list.push(item);
  if (list.length > cap) list.shift();
  return item;
}

/** Everything the UI needs, without the internals or the compiled script. */
export function snapshot(job) {
  return {
    id: job.id,
    name: job.name,
    status: job.status,
    error: job.error,
    startedAt: job.startedAt,
    finishedAt: job.finishedAt,
    config: job.config,
    stats: job.stats,
    vars: job.vars,
    logs: job.logs,
    rows: job.rows,
    requests: job.requests,
  };
}

export function getJob(id) {
  return jobs.get(id);
}

export function listJobs() {
  return [...jobs.values()]
    .sort((a, b) => b.startedAt - a.startedAt)
    .map((job) => ({
      id: job.id,
      name: job.name,
      status: job.status,
      startedAt: job.startedAt,
      finishedAt: job.finishedAt,
      stats: job.stats,
    }));
}

export function stopJob(id) {
  const job = jobs.get(id);
  if (!job || job.status !== 'running') return false;
  job.stopRequested = true;
  job.emitter.emit('event', { type: 'log', data: { level: 'warn', message: 'Stop requested', ts: Date.now() } });
  return true;
}

export function deleteJob(id) {
  const job = jobs.get(id);
  if (!job) return false;
  job.stopRequested = true;
  jobs.delete(id);
  return true;
}

/** Drop finished jobs so a long session does not pile them up forever. */
export function pruneJobs(keep = 20) {
  const finished = [...jobs.values()]
    .filter((job) => job.status !== 'running')
    .sort((a, b) => b.startedAt - a.startedAt)
    .slice(keep);
  for (const job of finished) jobs.delete(job.id);
}

/**
 * The `pg` object a job script sees. One per iteration, but the variable
 * scopes, counters and buffers are shared with the job so values carry over.
 */
function buildContext(job, iteration) {
  const emit = (type, data) => job.emitter.emit('event', { type, data });

  const log = (level) => (...args) => {
    const entry = push(
      job.logs,
      { level, iteration, message: args.map(serialiseLogArg).join(' '), ts: Date.now() },
      MAX_LOGS,
    );
    emit('log', entry);
  };

  const consoleApi = {
    log: log('log'),
    info: log('info'),
    warn: log('warn'),
    error: log('error'),
    debug: log('debug'),
  };

  const scope = (values) => ({
    get: (key) => values[key],
    set: (key, value) => {
      values[key] = value === null || value === undefined ? '' : String(value);
    },
    unset: (key) => {
      delete values[key];
    },
    has: (key) => Object.hasOwn(values, key),
    toObject: () => ({ ...values }),
  });

  const rows = (obj) =>
    Object.entries(obj ?? {}).map(([key, value]) => ({
      key,
      value: value === null || value === undefined ? '' : String(value),
      enabled: true,
    }));

  /**
   * Every call is logged with its response body, which is the whole point of
   * the Requests tab — a slow poller wants to see what each call answered.
   */
  const send = async (input) => {
    const req =
      typeof input === 'string'
        ? { method: 'GET', url: input }
        : {
            method: input.method ?? 'GET',
            url: input.url,
            headers: Array.isArray(input.headers) ? input.headers : rows(input.headers),
            params: Array.isArray(input.params) ? input.params : rows(input.params),
            auth: input.auth,
            body: input.body,
          };

    const started = Date.now();
    const result = await sendRequest(req);
    job.stats.requests += 1;

    const ok = !result.error && result.status < 400;
    if (ok) job.stats.ok += 1;
    else job.stats.failed += 1;

    const body = result.body ?? '';
    const entry = push(
      job.requests,
      {
        n: job.stats.requests,
        iteration,
        method: req.method ?? 'GET',
        url: result.url ?? req.url,
        status: result.status ?? null,
        statusText: result.statusText ?? '',
        ok,
        time: result.time ?? Date.now() - started,
        size: result.size ?? null,
        via: result.via ?? null,
        error: result.error ?? null,
        headers: result.headers ?? {},
        body: body.length > MAX_BODY_CHARS ? body.slice(0, MAX_BODY_CHARS) : body,
        bodyTruncated: body.length > MAX_BODY_CHARS,
        at: started,
      },
      MAX_REQUESTS,
    );
    emit('request', entry);

    if (result.error) throw new Error(result.error);
    return {
      status: result.status,
      statusText: result.statusText,
      headers: result.headers ?? {},
      body: result.body ?? '',
      time: result.time,
      size: result.size,
      via: result.via,
      url: result.url,
      text: () => result.body ?? '',
      json: () => JSON.parse(result.body ?? ''),
      tryJson: () => {
        try {
          return JSON.parse(result.body ?? '');
        } catch {
          return undefined;
        }
      },
      header: (name) => {
        const key = Object.keys(result.headers ?? {}).find(
          (h) => h.toLowerCase() === String(name).toLowerCase(),
        );
        return key ? result.headers[key] : undefined;
      },
    };
  };

  const utils = makeUtils({ maxSleepMs: job.config.maxRuntimeMs });

  const pg = {
    job: {
      id: job.id,
      name: job.name,
      iteration,
      iterations: job.config.iterations,
      concurrency: job.config.concurrency,
      intervalMs: job.config.intervalMs,
      get stopping() {
        return job.stopRequested;
      },
    },
    vars: scope(job.vars),
    env: scope(job.environment),
    environment: scope(job.environment),
    globals: scope(job.globals),
    console: consoleApi,
    expect,
    utils,
    sleep: utils.sleep,
    sendRequest: send,

    /** Add a row to the Results table — custom columns, whatever the script wants. */
    record: (row) => {
      const entry = push(
        job.rows,
        { iteration, at: Date.now(), ...(row && typeof row === 'object' ? row : { value: row }) },
        MAX_ROWS,
      );
      emit('row', entry);
      return entry;
    },

    /** Run `worker` over `items`, at most `concurrency` in flight. */
    batch: async (items, worker, concurrency = job.config.concurrency) => {
      const queue = [...items];
      const results = [];
      await Promise.all(
        Array.from({ length: Math.max(1, Number(concurrency) || 1) }, async () => {
          while (queue.length && !job.stopRequested) {
            const item = queue.shift();
            try {
              results.push({ item, ok: true, value: await worker(item) });
            } catch (err) {
              results.push({ item, ok: false, error: err.message });
            }
          }
        }),
      );
      return results;
    },

    stop: () => {
      job.stopRequested = true;
    },
  };

  return {
    pg,
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
}

async function runIteration(job, iteration) {
  const sandbox = buildContext(job, iteration);
  sandbox.globalThis = sandbox;
  const context = vm.createContext(sandbox, { name: `postguy:job:${job.id}` });
  const script = new vm.Script(`(async () => {\n${job.code}\n})()`, {
    filename: `job-${job.name || job.id}.js`,
  });

  // The timeout only bounds synchronous execution, which is exactly what is
  // wanted: an awaited sleep of an hour is fine, a spinning loop is not.
  await script.runInContext(context, { timeout: SYNC_TIMEOUT_MS });
}

async function runJob(job) {
  const { iterations, concurrency, intervalMs } = job.config;
  const queue = Array.from({ length: iterations }, (_, i) => i + 1);
  const deadline = job.startedAt + job.config.maxRuntimeMs;

  const worker = async () => {
    while (queue.length && !job.stopRequested) {
      if (Date.now() > deadline) {
        job.stopRequested = true;
        job.error = 'Maximum run time reached';
        break;
      }

      const iteration = queue.shift();
      const started = Date.now();
      try {
        await runIteration(job, iteration);
        job.stats.iterationsOk += 1;
      } catch (err) {
        job.stats.iterationsFailed += 1;
        const entry = push(
          job.logs,
          { level: 'error', iteration, message: `${err.name}: ${err.message}`, ts: Date.now() },
          MAX_LOGS,
        );
        job.emitter.emit('event', { type: 'log', data: entry });
      }

      job.stats.iterationsDone += 1;
      job.stats.lastIterationMs = Date.now() - started;
      job.emitter.emit('event', { type: 'progress', data: job.stats });

      // The pause belongs between iterations, not after the last one.
      if (queue.length && intervalMs > 0 && !job.stopRequested) {
        await new Promise((resolve) => setTimeout(resolve, intervalMs));
      }
    }
  };

  await Promise.all(Array.from({ length: concurrency }, worker));
}

export function startJob({
  name = 'Script',
  code = '',
  vars = {},
  environment = {},
  globals = {},
  iterations = 1,
  concurrency = 1,
  intervalMs = 0,
  maxRuntimeMs = DEFAULT_MAX_RUNTIME_MS,
}) {
  const job = {
    id: randomUUID().slice(0, 8),
    name,
    code,
    vars: { ...vars },
    environment: { ...environment },
    globals: { ...globals },
    config: {
      iterations: Math.max(1, Number(iterations) || 1),
      concurrency: Math.max(1, Number(concurrency) || 1),
      intervalMs: Math.max(0, Number(intervalMs) || 0),
      maxRuntimeMs: Math.max(1000, Number(maxRuntimeMs) || DEFAULT_MAX_RUNTIME_MS),
    },
    status: 'running',
    error: null,
    startedAt: Date.now(),
    finishedAt: null,
    stopRequested: false,
    stats: {
      iterationsDone: 0,
      iterationsOk: 0,
      iterationsFailed: 0,
      iterationsTotal: Math.max(1, Number(iterations) || 1),
      requests: 0,
      ok: 0,
      failed: 0,
      lastIterationMs: null,
    },
    logs: [],
    rows: [],
    requests: [],
    emitter: new EventEmitter(),
  };
  // Several browser tabs may watch the same job.
  job.emitter.setMaxListeners(50);

  jobs.set(job.id, job);
  pruneJobs();

  runJob(job)
    .catch((err) => {
      job.error = `${err.name}: ${err.message}`;
    })
    .finally(() => {
      job.status = job.error ? 'error' : job.stopRequested ? 'stopped' : 'done';
      job.finishedAt = Date.now();
      job.emitter.emit('event', {
        type: 'status',
        data: { status: job.status, error: job.error, stats: job.stats, vars: job.vars },
      });
    });

  return job;
}
