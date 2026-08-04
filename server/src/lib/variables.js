import { randomUUID } from 'node:crypto';

const VAR_PATTERN = /\{\{\s*([^{}\s]+)\s*\}\}/g;

/**
 * Dynamic variables, resolved fresh on every use — the `{{$uuid}}` family.
 */
const dynamic = {
  $uuid: () => randomUUID(),
  $guid: () => randomUUID(),
  $timestamp: () => String(Math.floor(Date.now() / 1000)),
  $isoTimestamp: () => new Date().toISOString(),
  $randomInt: () => String(Math.floor(Math.random() * 1000)),
  $randomHex: () => Math.floor(Math.random() * 0xffffff).toString(16).padStart(6, '0'),
  $randomEmail: () => `user${Math.floor(Math.random() * 100000)}@example.com`,
  $randomFirstName: () => {
    const names = ['Alice', 'Bao', 'Chi', 'Dylan', 'Emma', 'Huy', 'Linh', 'Minh', 'Nam', 'Olivia'];
    return names[Math.floor(Math.random() * names.length)];
  },
};

/**
 * Replace `{{name}}` tokens in a string. Later scopes win, so pass them in
 * priority order: globals first, environment last.
 */
export function resolveString(input, scope) {
  if (typeof input !== 'string' || !input.includes('{{')) return input;
  return input.replace(VAR_PATTERN, (match, name) => {
    if (Object.hasOwn(dynamic, name)) return dynamic[name]();
    if (scope && Object.hasOwn(scope, name)) {
      const value = scope[name];
      return value === null || value === undefined ? '' : String(value);
    }
    return match; // leave unknown variables visible rather than blanking them
  });
}

/** Recursively resolve every string in a request definition. */
export function resolveDeep(value, scope) {
  if (typeof value === 'string') return resolveString(value, scope);
  if (Array.isArray(value)) return value.map((item) => resolveDeep(item, scope));
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value)) out[k] = resolveDeep(v, scope);
    return out;
  }
  return value;
}

export const dynamicVariableNames = Object.keys(dynamic);
