import { Buffer } from 'node:buffer';
import { fetch } from 'undici';

import { cookieHeaderFor, storeSetCookies } from './cookies.js';
import { buildDispatcher } from './proxy.js';
import { getSettings } from './settings.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024; // keep the UI responsive on huge payloads

/** Turn `[{ key, value, enabled }]` rows from the UI into a plain object. */
export function rowsToObject(rows) {
  const out = {};
  for (const row of rows ?? []) {
    if (!row || row.enabled === false) continue;
    const key = String(row.key ?? '').trim();
    if (!key) continue;
    out[key] = String(row.value ?? '');
  }
  return out;
}

function applyAuth(auth, headers, url) {
  if (!auth || auth.type === 'none' || !auth.type) return;
  if (auth.type === 'bearer' && auth.token) {
    headers.Authorization = `Bearer ${auth.token}`;
  } else if (auth.type === 'basic') {
    const raw = `${auth.username ?? ''}:${auth.password ?? ''}`;
    headers.Authorization = `Basic ${Buffer.from(raw).toString('base64')}`;
  } else if (auth.type === 'apiKey' && auth.key) {
    if (auth.in === 'query') url.searchParams.set(auth.key, auth.value ?? '');
    else headers[auth.key] = auth.value ?? '';
  } else if (auth.type === 'oauth2' && auth.accessToken) {
    headers.Authorization = `${auth.tokenType || 'Bearer'} ${auth.accessToken}`;
  }
}

function buildBody(request, headers) {
  const { method, body } = request;
  if (method === 'GET' || method === 'HEAD') return undefined;
  const mode = body?.mode ?? 'none';

  if (mode === 'none') return undefined;

  if (mode === 'raw') {
    const text = body.raw ?? '';
    if (!text) return undefined;
    const hasContentType = Object.keys(headers).some((h) => h.toLowerCase() === 'content-type');
    if (!hasContentType) {
      const lang = body.language ?? 'json';
      headers['Content-Type'] =
        lang === 'json'
          ? 'application/json'
          : lang === 'xml'
            ? 'application/xml'
            : lang === 'html'
              ? 'text/html'
              : 'text/plain';
    }
    return text;
  }

  if (mode === 'urlencoded') {
    const params = new URLSearchParams(rowsToObject(body.urlencoded));
    const hasContentType = Object.keys(headers).some((h) => h.toLowerCase() === 'content-type');
    if (!hasContentType) headers['Content-Type'] = 'application/x-www-form-urlencoded';
    return params.toString();
  }

  if (mode === 'formdata') {
    const form = new FormData();
    for (const [k, v] of Object.entries(rowsToObject(body.formdata))) form.append(k, v);
    // Let undici set the multipart boundary itself.
    delete headers['Content-Type'];
    delete headers['content-type'];
    return form;
  }

  return undefined;
}

/**
 * Execute a resolved request definition and return a serialisable response.
 * Never throws for HTTP-level failures — network errors come back as
 * `{ error }` so the UI can render them like Postman does.
 */
export async function sendRequest(request, options = {}) {
  const started = Date.now();
  const settings = options.settings ?? (await getSettings());
  let url;
  try {
    url = new URL(request.url);
  } catch {
    return {
      error: `Invalid URL: ${request.url || '(empty)'}`,
      time: 0,
    };
  }

  for (const [key, value] of Object.entries(rowsToObject(request.params))) {
    url.searchParams.set(key, value);
  }

  const headers = rowsToObject(request.headers);
  applyAuth(request.auth, headers, url);
  let body = buildBody(request, headers);

  const useCookies = settings.cookies?.enabled !== false && options.cookies !== false;
  if (useCookies) {
    const jarHeader = await cookieHeaderFor(url.toString());
    const explicit = Object.keys(headers).find((h) => h.toLowerCase() === 'cookie');
    if (jarHeader) {
      // A hand-written Cookie header wins; the jar only tops it up.
      headers[explicit ?? 'Cookie'] = explicit
        ? `${headers[explicit]}; ${jarHeader}`
        : jarHeader;
    }
  }

  const timeoutMs = request.timeout ?? settings.request?.timeout ?? DEFAULT_TIMEOUT_MS;
  const followRedirects =
    request.followRedirects ?? settings.request?.followRedirects !== false;
  const maxRedirects = settings.request?.maxRedirects ?? 5;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  const { dispatcher, viaProxy } = buildDispatcher(settings, url.toString());

  try {
    // Redirects are followed by hand so each hop can pick up the cookies the
    // previous hop set — the usual login → 302 → dashboard flow.
    let currentUrl = url;
    let res;
    let redirects = 0;
    const setCookies = [];

    for (;;) {
      res = await fetch(currentUrl, {
        method: request.method ?? 'GET',
        headers,
        body,
        redirect: 'manual',
        signal: controller.signal,
        dispatcher,
      });

      if (useCookies) {
        const hop = await storeSetCookies(res.headers.getSetCookie?.() ?? [], currentUrl.toString());
        setCookies.push(...hop);
      }

      const location = res.headers.get('location');
      const isRedirect = [301, 302, 303, 307, 308].includes(res.status);
      if (!followRedirects || !isRedirect || !location || redirects >= maxRedirects) break;

      const nextUrl = new URL(location, currentUrl);
      // 303 (and 301/302 in practice) turn the follow-up into a GET.
      if (res.status === 303 || ((res.status === 301 || res.status === 302) && request.method === 'POST')) {
        request = { ...request, method: 'GET' };
        body = undefined;
        delete headers['Content-Type'];
        delete headers['content-type'];
      }
      // Don't leak credentials to a different origin.
      if (nextUrl.origin !== currentUrl.origin) {
        for (const key of Object.keys(headers)) {
          if (key.toLowerCase() === 'authorization') delete headers[key];
        }
      }
      if (useCookies) {
        const jarHeader = await cookieHeaderFor(nextUrl.toString());
        const existing = Object.keys(headers).find((h) => h.toLowerCase() === 'cookie');
        if (existing) delete headers[existing];
        if (jarHeader) headers.Cookie = jarHeader;
      }

      await res.body?.cancel().catch(() => {});
      currentUrl = nextUrl;
      redirects += 1;
    }

    const buffer = Buffer.from(await res.arrayBuffer());
    const truncated = buffer.byteLength > MAX_BODY_BYTES;
    const slice = truncated ? buffer.subarray(0, MAX_BODY_BYTES) : buffer;

    const responseHeaders = {};
    for (const [k, v] of res.headers.entries()) responseHeaders[k] = v;

    return {
      status: res.status,
      statusText: res.statusText,
      headers: responseHeaders,
      body: slice.toString('utf8'),
      size: buffer.byteLength,
      truncated,
      time: Date.now() - started,
      url: currentUrl.toString(),
      redirects,
      viaProxy,
      setCookies,
      request: {
        method: request.method ?? 'GET',
        url: url.toString(),
        headers,
      },
    };
  } catch (err) {
    const reason = err.cause?.message ?? err.message;
    return {
      error:
        err.name === 'AbortError'
          ? `Request timed out after ${timeoutMs} ms`
          : viaProxy
            ? `Proxy error: ${reason}`
            : reason,
      viaProxy,
      time: Date.now() - started,
    };
  } finally {
    clearTimeout(timeout);
    dispatcher?.close?.().catch(() => {});
  }
}
