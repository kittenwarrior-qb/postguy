/**
 * Import an OpenAPI 3.x or Swagger 2.0 description as a collection.
 *
 * Path templates become Postguy variables (`/users/{id}` → `/users/{{id}}`) and
 * every one of them is seeded into the environment the import creates, so a
 * freshly imported request resolves instead of sending a literal brace.
 */

const METHODS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'];
const MAX_DEPTH = 6;

export function isOpenApi(data) {
  return Boolean(
    data && typeof data === 'object' && (data.openapi || data.swagger) && data.paths,
  );
}

function resolveRef(ref, root, seen = new Set()) {
  if (typeof ref !== 'string' || !ref.startsWith('#/')) return null;
  if (seen.has(ref)) return null; // a schema that references itself
  seen.add(ref);
  let node = root;
  for (const part of ref.slice(2).split('/')) {
    const key = part.replace(/~1/g, '/').replace(/~0/g, '~');
    node = node?.[key];
    if (node === undefined) return null;
  }
  return node?.$ref ? resolveRef(node.$ref, root, seen) : node;
}

function deref(schema, root) {
  if (!schema) return schema;
  if (schema.$ref) return deref(resolveRef(schema.$ref, root) ?? {}, root);
  return schema;
}

function sampleFor(format, name = '') {
  const hint = `${format ?? ''} ${name}`.toLowerCase();
  if (hint.includes('date-time')) return new Date().toISOString();
  if (hint.includes('date')) return new Date().toISOString().slice(0, 10);
  if (hint.includes('uuid')) return '00000000-0000-0000-0000-000000000000';
  if (hint.includes('email')) return 'user@example.com';
  if (hint.includes('uri') || hint.includes('url')) return 'https://example.com';
  if (hint.includes('password')) return 'secret';
  if (hint.includes('byte') || hint.includes('binary')) return '';
  return 'string';
}

/** Build a plausible request body from a JSON Schema. */
function exampleFromSchema(rawSchema, root, depth = 0, name = '') {
  const schema = deref(rawSchema, root);
  if (!schema || depth > MAX_DEPTH) return null;

  if (schema.example !== undefined) return schema.example;
  if (schema.default !== undefined) return schema.default;
  if (Array.isArray(schema.enum) && schema.enum.length) return schema.enum[0];

  // Composition: merge what we can, otherwise take the first branch.
  if (Array.isArray(schema.allOf)) {
    return schema.allOf.reduce((acc, part) => {
      const value = exampleFromSchema(part, root, depth, name);
      return value && typeof value === 'object' && !Array.isArray(value)
        ? { ...acc, ...value }
        : acc;
    }, {});
  }
  const branch = schema.oneOf?.[0] ?? schema.anyOf?.[0];
  if (branch) return exampleFromSchema(branch, root, depth, name);

  const type = schema.type ?? (schema.properties ? 'object' : schema.items ? 'array' : 'string');

  switch (type) {
    case 'object': {
      const out = {};
      for (const [key, property] of Object.entries(schema.properties ?? {})) {
        if (deref(property, root)?.readOnly) continue;
        out[key] = exampleFromSchema(property, root, depth + 1, key);
      }
      return out;
    }
    case 'array':
      return [exampleFromSchema(schema.items, root, depth + 1, name)].filter(
        (item) => item !== null,
      );
    case 'integer':
      return schema.minimum ?? 0;
    case 'number':
      return schema.minimum ?? 0;
    case 'boolean':
      return true;
    case 'null':
      return null;
    default:
      return sampleFor(schema.format, name);
  }
}

function baseUrlOf(data, warnings) {
  if (Array.isArray(data.servers) && data.servers.length) {
    let url = String(data.servers[0].url ?? '').replace(/\/+$/, '');
    // Server templates: `https://{region}.api.com` — keep them as variables.
    url = url.replace(/\{([^}]+)\}/g, '{{$1}}');
    if (url.startsWith('/')) {
      warnings.push('The spec uses a relative server URL — set baseUrl yourself');
      return { baseUrl: '', pathPrefix: url };
    }
    return { baseUrl: url, pathPrefix: '' };
  }

  // Swagger 2.0
  if (data.host) {
    const scheme = (data.schemes ?? ['https'])[0];
    const basePath = String(data.basePath ?? '').replace(/\/+$/, '');
    return { baseUrl: `${scheme}://${data.host}${basePath}`, pathPrefix: '' };
  }

  warnings.push('The spec declares no server — set baseUrl in the environment');
  return { baseUrl: '', pathPrefix: '' };
}

function authFor(security, schemes, warnings) {
  const requirement = security?.[0];
  if (!requirement) return { type: 'none' };
  const [name] = Object.keys(requirement);
  const scheme = schemes?.[name];
  if (!scheme) return { type: 'none' };

  const type = String(scheme.type ?? '').toLowerCase();
  if (type === 'http') {
    const httpScheme = String(scheme.scheme ?? '').toLowerCase();
    if (httpScheme === 'bearer') return { type: 'bearer', token: '{{token}}' };
    if (httpScheme === 'basic') return { type: 'basic', username: '{{username}}', password: '{{password}}' };
  }
  if (type === 'apikey') {
    return {
      type: 'apiKey',
      key: String(scheme.name ?? 'X-API-Key'),
      value: '{{apiKey}}',
      in: scheme.in === 'query' ? 'query' : 'header',
    };
  }
  if (type === 'basic') return { type: 'basic', username: '{{username}}', password: '{{password}}' };
  if (type === 'oauth2') return { type: 'bearer', token: '{{token}}' };

  warnings.push(`Security scheme "${name}" (${type}) needs setting up by hand`);
  return { type: 'none' };
}

export function parseOpenApi(data) {
  const warnings = [];
  const { baseUrl, pathPrefix } = baseUrlOf(data, warnings);
  const schemes = data.components?.securitySchemes ?? data.securityDefinitions ?? {};
  const requests = [];
  const pathVariables = new Set();

  for (const [path, pathItem] of Object.entries(data.paths ?? {})) {
    if (!pathItem || typeof pathItem !== 'object') continue;

    for (const method of METHODS) {
      const operation = pathItem[method];
      if (!operation || typeof operation !== 'object') continue;

      // Path-level parameters apply to every operation under it.
      const parameters = [...(pathItem.parameters ?? []), ...(operation.parameters ?? [])].map(
        (parameter) => deref(parameter, data) ?? parameter,
      );

      const params = [];
      const headers = [];
      for (const parameter of parameters) {
        if (!parameter?.name) continue;
        const example =
          parameter.example ??
          parameter.schema?.example ??
          exampleFromSchema(parameter.schema ?? { type: parameter.type ?? 'string' }, data, 5, parameter.name);
        const value = example === null || typeof example === 'object' ? '' : String(example);

        if (parameter.in === 'query') {
          params.push({ key: parameter.name, value, enabled: parameter.required === true });
        } else if (parameter.in === 'header') {
          headers.push({ key: parameter.name, value, enabled: parameter.required === true });
        }
        // `in: path` is handled by the URL template below.
      }

      for (const match of `${path}`.matchAll(/\{([^}]+)\}/g)) pathVariables.add(match[1]);
      const templatedPath = `${pathPrefix}${path}`.replace(/\{([^}]+)\}/g, '{{$1}}');

      let body = { mode: 'none', language: 'json', raw: '', urlencoded: [], formdata: [] };
      const content = operation.requestBody
        ? (deref(operation.requestBody, data)?.content ?? {})
        : null;

      if (content) {
        const jsonType = Object.keys(content).find((type) => type.includes('json'));
        const formType = Object.keys(content).find((type) => type.includes('x-www-form-urlencoded'));
        const multipartType = Object.keys(content).find((type) => type.includes('multipart'));

        if (jsonType) {
          const media = content[jsonType];
          const example =
            media.example ??
            Object.values(media.examples ?? {})[0]?.value ??
            exampleFromSchema(media.schema, data);
          body = {
            ...body,
            mode: 'raw',
            language: 'json',
            raw: example === null ? '' : JSON.stringify(example, null, 2),
          };
          headers.push({ key: 'Content-Type', value: jsonType, enabled: true });
        } else if (formType || multipartType) {
          const media = content[formType ?? multipartType];
          const properties = deref(media.schema, data)?.properties ?? {};
          const fields = Object.entries(properties).map(([key, property]) => {
            const value = exampleFromSchema(property, data, 5, key);
            return {
              key,
              value: value === null || typeof value === 'object' ? '' : String(value),
              enabled: true,
            };
          });
          body = formType
            ? { ...body, mode: 'urlencoded', urlencoded: fields }
            : { ...body, mode: 'formdata', formdata: fields };
        } else {
          const [type] = Object.keys(content);
          warnings.push(`${method.toUpperCase()} ${path} sends ${type}, which was left empty`);
        }
      } else if (data.swagger) {
        // Swagger 2.0 puts the body in `parameters` with `in: body`.
        const bodyParameter = parameters.find((parameter) => parameter?.in === 'body');
        if (bodyParameter) {
          const example = exampleFromSchema(bodyParameter.schema, data);
          body = {
            ...body,
            mode: 'raw',
            language: 'json',
            raw: example === null ? '' : JSON.stringify(example, null, 2),
          };
          headers.push({ key: 'Content-Type', value: 'application/json', enabled: true });
        }
        const formParameters = parameters.filter((parameter) => parameter?.in === 'formData');
        if (formParameters.length) {
          body = {
            ...body,
            mode: 'urlencoded',
            urlencoded: formParameters.map((parameter) => ({
              key: parameter.name,
              value: '',
              enabled: parameter.required === true,
            })),
          };
        }
      }

      const tag = operation.tags?.[0];
      const label = operation.summary || operation.operationId || `${method.toUpperCase()} ${path}`;

      requests.push({
        name: tag ? `${tag} / ${label}` : label,
        method: method.toUpperCase(),
        url: `${baseUrl ? '{{baseUrl}}' : ''}${templatedPath}`,
        params,
        headers,
        auth: authFor(operation.security ?? data.security, schemes, warnings),
        body,
        scripts: { preRequest: '', postResponse: '' },
      });
    }
  }

  if (!requests.length) return { ok: false, error: 'The spec describes no operations' };

  const values = {};
  if (baseUrl) values.baseUrl = baseUrl;
  for (const variable of pathVariables) values[variable] = '';
  for (const server of data.servers ?? []) {
    for (const [name, variable] of Object.entries(server.variables ?? {})) {
      values[name] = String(variable.default ?? '');
    }
  }
  if (Object.values(values).some((value) => value === '')) {
    warnings.push('Path variables were added to the environment — fill them in before sending');
  }

  const title = data.info?.title ?? 'Imported API';
  return {
    ok: true,
    warnings,
    collection: { name: `${title}${data.info?.version ? ` ${data.info.version}` : ''}`, requests },
    environment: Object.keys(values).length ? { name: `${title} environment`, values } : null,
  };
}
