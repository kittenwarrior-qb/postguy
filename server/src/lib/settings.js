import { read, write } from './store.js';

export const DEFAULT_SETTINGS = {
  proxy: {
    enabled: false,
    protocol: 'http',
    host: '',
    port: 8080,
    auth: { enabled: false, username: '', password: '' },
    // Hosts that should always go direct, even when the proxy is on.
    bypass: ['localhost', '127.0.0.1'],
  },
  request: {
    timeout: 60000,
    followRedirects: true,
    maxRedirects: 5,
    // Off lets you talk to a dev server with a self-signed certificate.
    verifySsl: true,
  },
  cookies: {
    enabled: true,
  },
};

function mergeDeep(base, override) {
  if (!override || typeof override !== 'object') return base;
  const out = Array.isArray(base) ? [...base] : { ...base };
  for (const [key, value] of Object.entries(override)) {
    if (value && typeof value === 'object' && !Array.isArray(value) && typeof out[key] === 'object') {
      out[key] = mergeDeep(out[key], value);
    } else if (value !== undefined) {
      out[key] = value;
    }
  }
  return out;
}

export async function getSettings() {
  const stored = await read('settings');
  return mergeDeep(DEFAULT_SETTINGS, Array.isArray(stored) ? {} : stored);
}

export async function saveSettings(patch) {
  const next = mergeDeep(await getSettings(), patch);
  await write('settings', next);
  return next;
}
