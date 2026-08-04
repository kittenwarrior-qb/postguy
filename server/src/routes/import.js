import { Router } from 'express';
import { parse as parseYaml } from 'yaml';

import { parseCurl } from '../lib/import/curl.js';
import { isOpenApi, parseOpenApi } from '../lib/import/openapi.js';
import {
  isPostmanCollection,
  isPostmanEnvironment,
  parsePostmanCollection,
  parsePostmanEnvironment,
} from '../lib/import/postman.js';

export const importRouter = Router();

function looksLikeCurl(text) {
  const head = text.trimStart().slice(0, 400);
  return /^\s*(?:\$\s*)?(?:[\w./\\-]*curl)\b/i.test(head);
}

/** JSON first, then YAML — OpenAPI is published in both. */
function parseDocument(text) {
  try {
    return { data: JSON.parse(text), format: 'json' };
  } catch {
    /* not JSON; try YAML */
  }
  try {
    const data = parseYaml(text);
    if (data && typeof data === 'object') return { data, format: 'yaml' };
  } catch (err) {
    return { error: err.message };
  }
  return { error: 'Not JSON or YAML' };
}

/**
 * Work out what was pasted and turn it into Postguy shapes. Nothing is written
 * to disk here — the client shows a preview and saves what the user confirms.
 */
export function importAnything(text, hint = 'auto') {
  const input = String(text ?? '').trim();
  if (!input) return { ok: false, error: 'Nothing to import' };

  if (hint === 'curl' || (hint === 'auto' && looksLikeCurl(input))) {
    const result = parseCurl(input);
    return result.ok ? { ...result, kind: 'request', format: 'curl' } : result;
  }

  const { data, format, error } = parseDocument(input);
  if (error) {
    return {
      ok: false,
      error: looksLikeCurl(input)
        ? `Could not read the curl command: ${error}`
        : `Could not read this as curl, JSON or YAML (${error})`,
    };
  }

  if (isPostmanCollection(data)) {
    const result = parsePostmanCollection(data);
    return result.ok ? { ...result, kind: 'collection', format: `postman/${format}` } : result;
  }
  if (isOpenApi(data)) {
    const result = parseOpenApi(data);
    return result.ok ? { ...result, kind: 'collection', format: `openapi/${format}` } : result;
  }
  if (isPostmanEnvironment(data)) {
    const result = parsePostmanEnvironment(data);
    return result.ok ? { ...result, kind: 'environment', format: `postman-env/${format}` } : result;
  }

  return {
    ok: false,
    error:
      'Recognised the file as JSON/YAML but not as a Postman collection, a Postman environment or an OpenAPI spec',
  };
}

importRouter.post('/import', (req, res) => {
  const result = importAnything(req.body?.text, req.body?.type ?? 'auto');
  if (!result.ok) return res.status(400).json({ error: result.error });
  res.json({
    kind: result.kind,
    format: result.format,
    warnings: result.warnings ?? [],
    request: result.request ?? null,
    collection: result.collection ?? null,
    environment: result.environment ?? null,
  });
});
