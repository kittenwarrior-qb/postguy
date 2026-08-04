/**
 * Import a Postman collection (schema v2.0 / v2.1) or an exported environment.
 *
 * Postguy has no folders, so nested items are flattened and the folder path is
 * kept in the request name — nothing is silently dropped.
 */

function rows(list) {
  return (list ?? [])
    .filter((entry) => entry && (entry.key ?? '') !== '')
    .map((entry) => ({
      key: String(entry.key),
      value: entry.value === undefined || entry.value === null ? '' : String(entry.value),
      description: typeof entry.description === 'string' ? entry.description : '',
      enabled: entry.disabled !== true,
    }));
}

/** Postman stores auth as `{ type, [type]: [{ key, value }] }`. */
function readAuth(auth, warnings) {
  if (!auth?.type || auth.type === 'noauth') return { type: 'none' };
  const flat = {};
  for (const entry of auth[auth.type] ?? []) {
    if (entry?.key) flat[entry.key] = entry.value;
  }

  switch (auth.type) {
    case 'bearer':
      return { type: 'bearer', token: String(flat.token ?? '') };
    case 'basic':
      return {
        type: 'basic',
        username: String(flat.username ?? ''),
        password: String(flat.password ?? ''),
      };
    case 'apikey':
      return {
        type: 'apiKey',
        key: String(flat.key ?? ''),
        value: String(flat.value ?? ''),
        in: flat.in === 'query' ? 'query' : 'header',
      };
    case 'oauth2':
      return {
        type: 'oauth2',
        accessToken: String(flat.accessToken ?? ''),
        tokenType: String(flat.tokenType || 'Bearer'),
        tokenUrl: String(flat.accessTokenUrl ?? ''),
        clientId: String(flat.clientId ?? ''),
        clientSecret: String(flat.clientSecret ?? ''),
        scope: String(flat.scope ?? ''),
        grantType: flat.grant_type === 'password_credentials' ? 'password' : 'client_credentials',
        clientAuth: flat.client_authentication === 'header' ? 'header' : 'body',
      };
    default:
      warnings.push(`Auth type "${auth.type}" is not supported and was set to none`);
      return { type: 'none' };
  }
}

function readUrl(url, warnings) {
  if (!url) return { url: '', params: [] };
  if (typeof url === 'string') return splitQuery(url);

  if (url.raw) {
    const result = splitQuery(url.raw);
    // The structured `query` array carries the disabled flags the raw string cannot.
    if (Array.isArray(url.query) && url.query.length) {
      result.params = rows(url.query);
    }
    return result;
  }

  // Build it back from the pieces.
  const protocol = url.protocol ? `${url.protocol}://` : '';
  const host = Array.isArray(url.host) ? url.host.join('.') : (url.host ?? '');
  const port = url.port ? `:${url.port}` : '';
  const path = Array.isArray(url.path) ? `/${url.path.join('/')}` : (url.path ?? '');
  if (!host) warnings.push('A request had no host and was imported with an empty URL');
  return { url: `${protocol}${host}${port}${path}`, params: rows(url.query) };
}

function splitQuery(raw) {
  const text = String(raw);
  const index = text.indexOf('?');
  if (index === -1) return { url: text, params: [] };
  const params = [];
  for (const pair of text.slice(index + 1).split('&')) {
    if (!pair) continue;
    const eq = pair.indexOf('=');
    const key = eq === -1 ? pair : pair.slice(0, eq);
    const value = eq === -1 ? '' : pair.slice(eq + 1);
    // Postman variables live in URLs; decodeURIComponent would break `{{a b}}`.
    params.push({ key: safeDecode(key), value: safeDecode(value), enabled: true });
  }
  return { url: text.slice(0, index), params };
}

function safeDecode(text) {
  try {
    return decodeURIComponent(text.replace(/\+/g, ' '));
  } catch {
    return text;
  }
}

function readBody(body, warnings, name) {
  const empty = { mode: 'none', language: 'json', raw: '', urlencoded: [], formdata: [] };
  if (!body || !body.mode) return empty;

  switch (body.mode) {
    case 'raw': {
      const language = body.options?.raw?.language ?? 'json';
      return {
        ...empty,
        mode: 'raw',
        raw: String(body.raw ?? ''),
        language: ['json', 'xml', 'html', 'text'].includes(language) ? language : 'text',
      };
    }
    case 'urlencoded':
      return { ...empty, mode: 'urlencoded', urlencoded: rows(body.urlencoded) };
    case 'formdata': {
      const files = (body.formdata ?? []).filter((entry) => entry?.type === 'file');
      if (files.length) {
        warnings.push(
          `"${name}" has ${files.length} file field(s) — the fields were kept, attach the files by hand`,
        );
      }
      return {
        ...empty,
        mode: 'formdata',
        formdata: (body.formdata ?? [])
          .filter((entry) => entry && (entry.key ?? '') !== '')
          .map((entry) => ({
            key: String(entry.key),
            value: entry.type === 'file' ? '' : String(entry.value ?? ''),
            enabled: entry.disabled !== true,
            type: entry.type === 'file' ? 'file' : 'text',
          })),
      };
    }
    case 'graphql': {
      // Postguy has no GraphQL mode; send it as the JSON body a server expects.
      let variables = body.graphql?.variables;
      if (typeof variables === 'string') {
        try {
          variables = JSON.parse(variables);
        } catch {
          variables = undefined;
        }
      }
      return {
        ...empty,
        mode: 'raw',
        language: 'json',
        raw: JSON.stringify(
          { query: body.graphql?.query ?? '', ...(variables ? { variables } : {}) },
          null,
          2,
        ),
      };
    }
    case 'file':
      warnings.push(`"${name}" sends a file as its body — pick the file again after importing`);
      return empty;
    default:
      warnings.push(`Body mode "${body.mode}" in "${name}" is not supported`);
      return empty;
  }
}

function readScripts(events) {
  const scripts = { preRequest: '', postResponse: '' };
  for (const event of events ?? []) {
    const code = (event?.script?.exec ?? []).join('\n').trim();
    if (!code) continue;
    if (event.listen === 'prerequest') scripts.preRequest = code;
    if (event.listen === 'test') scripts.postResponse = code;
  }
  return scripts;
}

/** Walk `item[]`, which nests folders inside folders. */
function walk(items, prefix, out, warnings, inherited) {
  for (const item of items ?? []) {
    if (!item) continue;
    const name = String(item.name ?? 'Untitled');
    const path = prefix ? `${prefix} / ${name}` : name;

    if (Array.isArray(item.item)) {
      walk(item.item, path, out, warnings, item.auth ? readAuth(item.auth, warnings) : inherited);
      continue;
    }
    if (!item.request) continue;

    const request = typeof item.request === 'string' ? { url: item.request } : item.request;
    const { url, params } = readUrl(request.url, warnings);
    const auth = request.auth ? readAuth(request.auth, warnings) : inherited;

    out.push({
      name: path,
      method: String(request.method ?? 'GET').toUpperCase(),
      url,
      params,
      headers: rows(request.header),
      auth: auth ?? { type: 'none' },
      body: readBody(request.body, warnings, path),
      scripts: readScripts(item.event),
    });
  }
}

export function isPostmanCollection(data) {
  return Boolean(
    data &&
      typeof data === 'object' &&
      Array.isArray(data.item) &&
      (data.info?.schema?.includes('getpostman.com') || data.info?.name || data.info?._postman_id),
  );
}

export function isPostmanEnvironment(data) {
  return Boolean(
    data &&
      typeof data === 'object' &&
      Array.isArray(data.values) &&
      !Array.isArray(data.item) &&
      (data._postman_variable_scope === 'environment' || data.name),
  );
}

export function parsePostmanCollection(data) {
  const warnings = [];
  const requests = [];
  const inherited = data.auth ? readAuth(data.auth, warnings) : { type: 'none' };
  walk(data.item, '', requests, warnings, inherited);

  if (!requests.length) return { ok: false, error: 'The collection has no requests' };

  // Collection variables become an environment, which is where Postguy keeps them.
  const values = {};
  for (const variable of data.variable ?? []) {
    if (variable?.key) values[variable.key] = String(variable.value ?? '');
  }

  return {
    ok: true,
    warnings,
    collection: { name: String(data.info?.name ?? 'Imported collection'), requests },
    environment: Object.keys(values).length
      ? { name: `${data.info?.name ?? 'Imported'} variables`, values }
      : null,
  };
}

export function parsePostmanEnvironment(data) {
  const values = {};
  for (const entry of data.values ?? []) {
    if (entry?.key && entry.enabled !== false) values[entry.key] = String(entry.value ?? '');
  }
  if (!Object.keys(values).length) return { ok: false, error: 'The environment has no values' };
  return {
    ok: true,
    warnings: [],
    environment: { name: String(data.name ?? 'Imported environment'), values },
  };
}
