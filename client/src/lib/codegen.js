import { buildUrlWithParams, urlWithoutQuery } from './request.js';

/**
 * Turn the request in front of you into runnable code.
 *
 * Auth is materialised the same way the sender does it, so the snippet works on
 * its own rather than quietly dropping the credentials. `{{variables}}` are left
 * alone — the point is to hand someone the shape of the call.
 */

export const CODE_TARGETS = [
  { id: 'curl', label: 'cURL', language: 'text' },
  { id: 'fetch', label: 'JavaScript · fetch', language: 'javascript' },
  { id: 'axios', label: 'JavaScript · axios', language: 'javascript' },
  { id: 'python', label: 'Python · requests', language: 'text' },
];

const activeRows = (rows) =>
  (rows ?? []).filter((row) => row.enabled !== false && String(row.key ?? '').trim());

function base64(text) {
  try {
    return btoa(text);
  } catch {
    return '<base64 of ' + text + '>';
  }
}

/** Headers plus whatever the auth type contributes, and any auth query param. */
function effective(request) {
  const headers = activeRows(request.headers).map(({ key, value }) => [key, value ?? '']);
  const query = activeRows(request.params).map(({ key, value }) => [key, value ?? '']);
  const auth = request.auth ?? { type: 'none' };
  let basic = null;

  if (auth.type === 'bearer' && auth.token) {
    headers.push(['Authorization', `Bearer ${auth.token}`]);
  } else if (auth.type === 'basic') {
    basic = { username: auth.username ?? '', password: auth.password ?? '' };
  } else if (auth.type === 'apiKey' && auth.key) {
    if (auth.in === 'query') query.push([auth.key, auth.value ?? '']);
    else headers.push([auth.key, auth.value ?? '']);
  } else if (auth.type === 'oauth2' && auth.accessToken) {
    headers.push(['Authorization', `${auth.tokenType || 'Bearer'} ${auth.accessToken}`]);
  }

  const body = request.body ?? { mode: 'none' };
  const mode = body.mode ?? 'none';
  const hasContentType = headers.some(([key]) => key.toLowerCase() === 'content-type');

  if (mode === 'raw' && body.raw && !hasContentType) {
    const language = body.language ?? 'json';
    headers.push([
      'Content-Type',
      language === 'json'
        ? 'application/json'
        : language === 'xml'
          ? 'application/xml'
          : language === 'html'
            ? 'text/html'
            : 'text/plain',
    ]);
  }
  if (mode === 'urlencoded' && !hasContentType) {
    headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
  }
  // multipart is left to the client library so it can set the boundary.

  const url = buildUrlWithParams(urlWithoutQuery(request.url ?? ''), [
    ...query.map(([key, value]) => ({ key, value, enabled: true })),
  ]);

  return { headers, url, basic, body, mode };
}

const fileNote = (rows) =>
  rows
    .filter((row) => row.type === 'file')
    .map((row) => row.fileName || row.key);

// --- cURL -------------------------------------------------------------------
function toCurl(request) {
  const { headers, url, basic, body, mode } = effective(request);
  const quote = (text) => `'${String(text).replace(/'/g, `'\\''`)}'`;
  const lines = [`curl --location ${quote(url)}`];

  const method = request.method ?? 'GET';
  if (method !== 'GET') lines.push(`  --request ${method}`);
  if (basic) lines.push(`  --user ${quote(`${basic.username}:${basic.password}`)}`);
  for (const [key, value] of headers) lines.push(`  --header ${quote(`${key}: ${value}`)}`);

  if (mode === 'raw' && body.raw) {
    lines.push(`  --data-raw ${quote(body.raw)}`);
  } else if (mode === 'urlencoded') {
    for (const { key, value } of activeRows(body.urlencoded)) {
      lines.push(`  --data-urlencode ${quote(`${key}=${value ?? ''}`)}`);
    }
  } else if (mode === 'formdata') {
    for (const row of activeRows(body.formdata)) {
      lines.push(
        row.type === 'file'
          ? `  --form ${quote(`${row.key}=@/path/to/${row.fileName || 'file'}`)}`
          : `  --form ${quote(`${row.key}=${row.value ?? ''}`)}`,
      );
    }
  } else if (mode === 'binary' && body.file) {
    lines.push(`  --data-binary ${quote(`@/path/to/${body.file.fileName || 'file'}`)}`);
  }

  return lines.join(' \\\n');
}

// --- fetch ------------------------------------------------------------------
function toFetch(request) {
  const { headers, url, basic, body, mode } = effective(request);
  const all = [...headers];
  if (basic) all.push(['Authorization', `Basic ${base64(`${basic.username}:${basic.password}`)}`]);

  const lines = [];
  const options = [`  method: ${JSON.stringify(request.method ?? 'GET')},`];

  if (all.length) {
    options.push('  headers: {');
    for (const [key, value] of all) options.push(`    ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
    options.push('  },');
  }

  if (mode === 'raw' && body.raw) {
    options.push(`  body: ${JSON.stringify(body.raw)},`);
  } else if (mode === 'urlencoded') {
    const pairs = activeRows(body.urlencoded).map(({ key, value }) => `  ${JSON.stringify(key)}: ${JSON.stringify(value ?? '')},`);
    lines.push('const body = new URLSearchParams({', ...pairs, '});', '');
    options.push('  body,');
  } else if (mode === 'formdata') {
    const rows = activeRows(body.formdata);
    lines.push('const body = new FormData();');
    for (const row of rows) {
      lines.push(
        row.type === 'file'
          ? `body.append(${JSON.stringify(row.key)}, fileInput.files[0]); // ${row.fileName || 'pick a file'}`
          : `body.append(${JSON.stringify(row.key)}, ${JSON.stringify(row.value ?? '')});`,
      );
    }
    lines.push('');
    options.push('  body,');
  } else if (mode === 'binary' && body.file) {
    lines.push(`// Attach ${body.file.fileName || 'the file'} yourself — a snippet cannot carry bytes.`);
    lines.push('const body = fileInput.files[0];', '');
    options.push('  body,');
  }

  lines.push(
    `const response = await fetch(${JSON.stringify(url)}, {`,
    ...options,
    '});',
    '',
    'console.log(response.status, await response.text());',
  );
  return lines.join('\n');
}

// --- axios ------------------------------------------------------------------
function toAxios(request) {
  const { headers, url, basic, body, mode } = effective(request);
  const lines = ["import axios from 'axios';", ''];
  const config = [
    `  method: ${JSON.stringify((request.method ?? 'GET').toLowerCase())},`,
    `  url: ${JSON.stringify(url)},`,
  ];

  if (headers.length) {
    config.push('  headers: {');
    for (const [key, value] of headers) config.push(`    ${JSON.stringify(key)}: ${JSON.stringify(value)},`);
    config.push('  },');
  }
  if (basic) {
    config.push(
      '  auth: {',
      `    username: ${JSON.stringify(basic.username)},`,
      `    password: ${JSON.stringify(basic.password)},`,
      '  },',
    );
  }

  if (mode === 'raw' && body.raw) {
    const parsed = body.language === 'json' ? tryParse(body.raw) : null;
    config.push(`  data: ${parsed ? indentJson(parsed, 2) : JSON.stringify(body.raw)},`);
  } else if (mode === 'urlencoded') {
    const pairs = activeRows(body.urlencoded).map(({ key, value }) => `  ${JSON.stringify(key)}: ${JSON.stringify(value ?? '')},`);
    lines.push('const data = new URLSearchParams({', ...pairs, '});', '');
    config.push('  data,');
  } else if (mode === 'formdata') {
    lines.push('const data = new FormData();');
    for (const row of activeRows(body.formdata)) {
      lines.push(
        row.type === 'file'
          ? `data.append(${JSON.stringify(row.key)}, fileInput.files[0]); // ${row.fileName || 'pick a file'}`
          : `data.append(${JSON.stringify(row.key)}, ${JSON.stringify(row.value ?? '')});`,
      );
    }
    lines.push('');
    config.push('  data,');
  } else if (mode === 'binary' && body.file) {
    lines.push(`// Attach ${body.file.fileName || 'the file'} yourself.`, 'const data = fileInput.files[0];', '');
    config.push('  data,');
  }

  lines.push('const response = await axios({', ...config, '});', '', 'console.log(response.status, response.data);');
  return lines.join('\n');
}

// --- Python requests --------------------------------------------------------
function toPython(request) {
  const { headers, url, basic, body, mode } = effective(request);
  const py = (value) => JSON.stringify(value); // JSON strings are valid Python literals
  const lines = ['import requests', ''];
  const args = [`    ${py(url)},`];

  if (headers.length) {
    lines.push('headers = {');
    for (const [key, value] of headers) lines.push(`    ${py(key)}: ${py(value)},`);
    lines.push('}', '');
    args.push('    headers=headers,');
  }
  if (basic) args.push(`    auth=(${py(basic.username)}, ${py(basic.password)}),`);

  if (mode === 'raw' && body.raw) {
    lines.push(`data = ${py(body.raw)}`, '');
    args.push('    data=data.encode(),');
  } else if (mode === 'urlencoded') {
    lines.push('data = {');
    for (const { key, value } of activeRows(body.urlencoded)) lines.push(`    ${py(key)}: ${py(value ?? '')},`);
    lines.push('}', '');
    args.push('    data=data,');
  } else if (mode === 'formdata') {
    const rows = activeRows(body.formdata);
    const files = rows.filter((row) => row.type === 'file');
    const fields = rows.filter((row) => row.type !== 'file');
    if (fields.length) {
      lines.push('data = {');
      for (const { key, value } of fields) lines.push(`    ${py(key)}: ${py(value ?? '')},`);
      lines.push('}', '');
      args.push('    data=data,');
    }
    if (files.length) {
      lines.push('files = {');
      for (const row of files) {
        lines.push(`    ${py(row.key)}: open(${py(row.fileName || 'file')}, 'rb'),`);
      }
      lines.push('}', '');
      args.push('    files=files,');
    }
  } else if (mode === 'binary' && body.file) {
    lines.push(`with open(${py(body.file.fileName || 'file')}, 'rb') as handle:`, '    data = handle.read()', '');
    args.push('    data=data,');
  }

  lines.push(
    `response = requests.${(request.method ?? 'GET').toLowerCase()}(`,
    ...args,
    ')',
    '',
    'print(response.status_code, response.text)',
  );
  return lines.join('\n');
}

function tryParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function indentJson(value, spaces) {
  return JSON.stringify(value, null, 2)
    .split('\n')
    .map((line, index) => (index === 0 ? line : `${' '.repeat(spaces)}${line}`))
    .join('\n');
}

const GENERATORS = { curl: toCurl, fetch: toFetch, axios: toAxios, python: toPython };

export function generateCode(request, target = 'curl') {
  const generator = GENERATORS[target] ?? toCurl;
  try {
    return generator(request);
  } catch (err) {
    return `// Could not generate this snippet: ${err.message}`;
  }
}

/** Files cannot travel in a snippet; warn instead of pretending. */
export function codeWarnings(request) {
  const warnings = [];
  const files = fileNote(activeRows(request.body?.formdata));
  if (files.length) warnings.push(`Attach by hand: ${files.join(', ')}`);
  if (request.body?.mode === 'binary' && request.body.file) {
    warnings.push(`The body is a file (${request.body.file.fileName}) — point the snippet at it`);
  }
  return warnings;
}
