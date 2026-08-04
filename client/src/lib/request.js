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

export const DEFAULT_SCRIPT = `// This script is one iteration. The toolbar decides how many iterations run,
// how many run at the same time, and how long to wait between them.

const base = pg.vars.get('baseUrl');
const res = await pg.sendRequest(\`\${base}/get?bot=\${pg.job.iteration}\`);
const data = res.tryJson() ?? {};

// Every call already shows up in the Requests tab with its full response.
// pg.record() adds a row to Results with whatever columns you want.
pg.record({ bot: pg.job.iteration, status: res.status, ms: res.time });

console.log(\`bot \${pg.job.iteration} → \${res.status}\`);
`;

export const INTERVAL_UNITS = [
  { id: 'ms', label: 'ms', ms: 1 },
  { id: 's', label: 'sec', ms: 1000 },
  { id: 'm', label: 'min', ms: 60_000 },
  { id: 'h', label: 'hour', ms: 3_600_000 },
];

export function intervalToMs(value, unit) {
  const found = INTERVAL_UNITS.find((item) => item.id === unit) ?? INTERVAL_UNITS[1];
  return Math.max(0, Number(value) || 0) * found.ms;
}

export function blankScript(overrides = {}) {
  return {
    id: uid('scr'),
    kind: 'script',
    name: 'New script',
    code: DEFAULT_SCRIPT,
    vars: [
      { id: uid('row'), key: 'baseUrl', value: 'https://httpbin.org', description: '', enabled: true },
      emptyRow(),
    ],
    config: { iterations: 1, concurrency: 1, interval: 0, intervalUnit: 's' },
    ...overrides,
  };
}

/** Variable rows → the plain object the job runner takes. */
export function varsToObject(rows) {
  const out = {};
  for (const row of rows ?? []) {
    if (!row || row.enabled === false) continue;
    const key = String(row.key ?? '').trim();
    if (key) out[key] = String(row.value ?? '');
  }
  return out;
}

/** Fold the values a finished job left behind back into the variable rows. */
export function mergeVarsIntoRows(rows, values) {
  const seen = new Set();
  const merged = (rows ?? []).map((row) => {
    const key = String(row.key ?? '').trim();
    if (!key || !Object.hasOwn(values ?? {}, key)) return row;
    seen.add(key);
    return { ...row, value: String(values[key]) };
  });
  for (const [key, value] of Object.entries(values ?? {})) {
    if (seen.has(key)) continue;
    merged.push({ id: uid('row'), key, value: String(value), description: '', enabled: true });
  }
  return merged;
}

export function formatDuration(ms) {
  if (ms === null || ms === undefined) return '—';
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.round((ms % 60_000) / 1000);
  if (minutes < 60) return `${minutes}m ${seconds}s`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
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
