export const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

export const METHOD_COLORS = {
  GET: '#2fa84f',
  POST: '#d99f24',
  PUT: '#3f8ee0',
  PATCH: '#8a63d2',
  DELETE: '#d94b4b',
  HEAD: '#19a5a5',
  OPTIONS: '#8b8b8b',
};

let counter = 0;
export function uid(prefix = 'id') {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

export function emptyRow() {
  return { id: uid('row'), key: '', value: '', description: '', enabled: true };
}

export function blankRequest(overrides = {}) {
  return {
    id: uid('req'),
    name: 'Untitled request',
    method: 'GET',
    url: '',
    params: [emptyRow()],
    headers: [emptyRow()],
    auth: { type: 'none' },
    body: { mode: 'none', language: 'json', raw: '', urlencoded: [emptyRow()], formdata: [emptyRow()] },
    scripts: { preRequest: '', postResponse: '' },
    ...overrides,
  };
}

/** Keep the URL's query string and the Params table in sync, Postman-style. */
export function paramsFromUrl(url) {
  const queryIndex = url.indexOf('?');
  if (queryIndex === -1) return null;
  const search = new URLSearchParams(url.slice(queryIndex + 1));
  const rows = [];
  for (const [key, value] of search.entries()) {
    rows.push({ id: uid('row'), key, value, description: '', enabled: true });
  }
  return rows.length ? rows : null;
}

export function urlWithoutQuery(url) {
  const queryIndex = url.indexOf('?');
  return queryIndex === -1 ? url : url.slice(0, queryIndex);
}

export function buildUrlWithParams(baseUrl, params) {
  const active = (params ?? []).filter((p) => p.enabled !== false && p.key.trim());
  if (!active.length) return urlWithoutQuery(baseUrl);
  const search = active
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value ?? '')}`)
    .join('&');
  return `${urlWithoutQuery(baseUrl)}?${search}`;
}

/** Strip UI-only fields before sending the request to the server. */
export function toWireRequest(request) {
  const clean = (rows) =>
    (rows ?? [])
      .filter((row) => row.key?.trim())
      .map(({ key, value, enabled }) => ({ key, value, enabled: enabled !== false }));

  return {
    name: request.name,
    method: request.method,
    url: urlWithoutQuery(request.url),
    params: clean(request.params),
    headers: clean(request.headers),
    auth: request.auth,
    body: {
      mode: request.body.mode,
      language: request.body.language,
      raw: request.body.raw,
      urlencoded: clean(request.body.urlencoded),
      formdata: clean(request.body.formdata),
    },
    scripts: request.scripts,
    followRedirects: request.followRedirects !== false,
  };
}

/** Count the badge numbers Postman shows on each tab. */
export function activeCount(rows) {
  return (rows ?? []).filter((row) => row.enabled !== false && row.key?.trim()).length;
}

export function formatBytes(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
}

export function statusColor(status) {
  if (!status) return '#d94b4b';
  if (status < 300) return '#2fa84f';
  if (status < 400) return '#3f8ee0';
  if (status < 500) return '#d99f24';
  return '#d94b4b';
}

export function prettyJson(text) {
  try {
    return JSON.stringify(JSON.parse(text), null, 2);
  } catch {
    return text;
  }
}
