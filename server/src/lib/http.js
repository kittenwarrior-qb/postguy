import { Blob, Buffer } from 'node:buffer';
// FormData must come from the same undici copy as `fetch`: the bundled classes
// are not the Node globals, and undici's instanceof check would miss them —
// which silently sent the string "[object FormData]" as the body.
import { FormData, fetch } from 'undici';

import { cookieHeaderFor, storeSetCookies } from './cookies.js';
import { buildDispatcher, markProxyDown, markProxyUp, orderedProxiesFor, proxyLabel } from './proxy.js';
import { getSettings } from './settings.js';

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_BODY_BYTES = 8 * 1024 * 1024; // keep the UI responsive on huge payloads

/** Errors that mean "this proxy is not answering", as opposed to a real reply. */
const RETRIABLE_CODES = new Set([
  'ECONNREFUSED',
  'ECONNRESET',
  'ETIMEDOUT',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENOTFOUND',
  'EPIPE',
  'EPROTO',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET',
  'UND_ERR_HEADERS_TIMEOUT',
  'UND_ERR_BODY_TIMEOUT',
]);

function isRetriable(err) {
  if (err?.name === 'AbortError') return true; // a dead proxy usually just hangs
  return RETRIABLE_CODES.has(err?.code) || RETRIABLE_CODES.has(err?.cause?.code);
}

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
    for (const row of body.formdata ?? []) {
      if (!row || row.enabled === false) continue;
      const key = String(row.key ?? '').trim();
      if (!key) continue;

      if (row.type === 'file') {
        // The browser cannot hand us a path, so the file arrives base64-encoded
        // in the request payload and is turned back into bytes here.
        if (!row.data) continue;
        const bytes = Buffer.from(String(row.data), 'base64');
        form.append(
          key,
          new Blob([bytes], { type: row.contentType || 'application/octet-stream' }),
          row.fileName || 'file',
        );
      } else {
        form.append(key, String(row.value ?? ''));
      }
    }
    // Let undici set the multipart boundary itself.
    delete headers['Content-Type'];
    delete headers['content-type'];
    return form;
  }

  if (mode === 'binary') {
    if (!body.file?.data) return undefined;
    const hasContentType = Object.keys(headers).some((h) => h.toLowerCase() === 'content-type');
    if (!hasContentType) {
      headers['Content-Type'] = body.file.contentType || 'application/octet-stream';
    }
    return Buffer.from(String(body.file.data), 'base64');
  }

  return undefined;
}

/**
 * Execute a resolved request definition and return a serialisable response.
 * Never throws for HTTP-level failures — network errors come back as
 * `{ error }` so the UI can render them like Postman does.
 *
 * When a proxy pool is configured the request is tried on one proxy and, if
 * that proxy will not connect, retried on the next one. `options.proxy` forces
 * a specific entry (or `null` for a direct connection), which is what the
 * "test proxy" button uses.
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

  const useCookies = settings.cookies?.enabled !== false && options.cookies !== false;
  const timeoutMs = request.timeout ?? settings.request?.timeout ?? DEFAULT_TIMEOUT_MS;
  const followRedirects = request.followRedirects ?? settings.request?.followRedirects !== false;
  const maxRedirects = settings.request?.maxRedirects ?? 5;

  /** One full attempt — headers and body are rebuilt so a retry starts clean. */
  async function attempt(entry) {
    const attemptUrl = new URL(url.toString());
    const headers = rowsToObject(request.headers);
    applyAuth(request.auth, headers, attemptUrl);
    let method = request.method ?? 'GET';
    let body = buildBody({ ...request, method }, headers);

    if (useCookies) {
      const jarHeader = await cookieHeaderFor(attemptUrl.toString());
      const explicit = Object.keys(headers).find((h) => h.toLowerCase() === 'cookie');
      if (jarHeader) {
        // A hand-written Cookie header wins; the jar only tops it up.
        headers[explicit ?? 'Cookie'] = explicit ? `${headers[explicit]}; ${jarHeader}` : jarHeader;
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const dispatcher = buildDispatcher(settings, entry);

    try {
      // Redirects are followed by hand so each hop can pick up the cookies the
      // previous hop set — the usual login → 302 → dashboard flow.
      let currentUrl = attemptUrl;
      let res;
      let redirects = 0;
      const setCookies = [];

      for (;;) {
        res = await fetch(currentUrl, {
          method,
          headers,
          body,
          redirect: 'manual',
          signal: controller.signal,
          dispatcher,
        });

        // The proxy itself rejecting our login is a proxy fault, not a reply
        // from the target — worth failing over to the next one.
        if (entry && res.status === 407) {
          await res.body?.cancel().catch(() => {});
          return {
            error: `Proxy authentication failed (407) on ${proxyLabel(entry)}`,
            retriable: true,
          };
        }

        if (useCookies) {
          const hop = await storeSetCookies(
            res.headers.getSetCookie?.() ?? [],
            currentUrl.toString(),
          );
          setCookies.push(...hop);
        }

        const location = res.headers.get('location');
        const isRedirect = [301, 302, 303, 307, 308].includes(res.status);
        if (!followRedirects || !isRedirect || !location || redirects >= maxRedirects) break;

        const nextUrl = new URL(location, currentUrl);
        // 303 (and 301/302 in practice) turn the follow-up into a GET.
        if (res.status === 303 || ((res.status === 301 || res.status === 302) && method === 'POST')) {
          method = 'GET';
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
        url: currentUrl.toString(),
        redirects,
        setCookies,
        request: {
          method: request.method ?? 'GET',
          url: attemptUrl.toString(),
          headers,
        },
      };
    } catch (err) {
      const reason = err.cause?.message ?? err.message;
      return {
        error:
          err.name === 'AbortError'
            ? `Request timed out after ${timeoutMs} ms`
            : entry
              ? `Proxy error on ${proxyLabel(entry)}: ${reason}`
              : reason,
        retriable: isRetriable(err),
      };
    } finally {
      clearTimeout(timeout);
      dispatcher?.close?.().catch(() => {});
    }
  }

  // `options.proxy` forces one specific route; otherwise the pool decides, and
  // an empty pool means a direct connection.
  const candidates =
    options.proxy !== undefined ? [options.proxy] : orderedProxiesFor(settings, url.toString());
  const route = candidates.length ? candidates : [null];
  const failover = settings.proxy?.failover !== false && options.proxy === undefined;

  const failed = [];
  for (let index = 0; index < route.length; index += 1) {
    const entry = route[index];
    const result = await attempt(entry);
    const via = entry ? proxyLabel(entry) : null;

    if (!result.error) {
      if (entry) markProxyUp(entry.id);
      return {
        ...result,
        time: Date.now() - started,
        viaProxy: Boolean(entry),
        via,
        proxyId: entry?.id ?? null,
        failedProxies: failed,
      };
    }

    if (entry) failed.push({ label: via, error: result.error });

    const isLast = index === route.length - 1;
    if (!entry || !failover || !result.retriable || isLast) {
      return {
        error: result.error,
        viaProxy: Boolean(entry),
        via,
        proxyId: entry?.id ?? null,
        failedProxies: failed,
        time: Date.now() - started,
      };
    }

    markProxyDown(entry.id);
  }

  // Unreachable: the loop always returns on its last iteration.
  return { error: 'No route available for this request', time: Date.now() - started };
}
