import { Buffer } from 'node:buffer';

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
export async function sendRequest(request) {
  const started = Date.now();
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
  const body = buildBody(request, headers);

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), request.timeout ?? DEFAULT_TIMEOUT_MS);

  try {
    const res = await fetch(url, {
      method: request.method ?? 'GET',
      headers,
      body,
      redirect: request.followRedirects === false ? 'manual' : 'follow',
      signal: controller.signal,
    });

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
      url: res.url || url.toString(),
      request: {
        method: request.method ?? 'GET',
        url: url.toString(),
        headers,
      },
    };
  } catch (err) {
    return {
      error: err.name === 'AbortError' ? 'Request timed out' : (err.cause?.message ?? err.message),
      time: Date.now() - started,
    };
  } finally {
    clearTimeout(timeout);
  }
}
