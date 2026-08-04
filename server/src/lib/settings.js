import { randomUUID } from 'node:crypto';

import { read, write } from './store.js';

export const DEFAULT_SETTINGS = {
  proxy: {
    enabled: false,
    // How the next proxy is picked out of the pool for each request.
    //   round-robin — walk the list in order, one request each
    //   sticky      — same host always gets the same proxy (keeps sessions alive)
    //   random      — pick one at random
    //   first       — always the first healthy one, the others are spares
    strategy: 'round-robin',
    // When a proxy refuses the connection, retry the request on the next one
    // instead of handing the user a connection error.
    failover: true,
    // Hosts that should always go direct, even when the proxy is on.
    bypass: ['localhost', '127.0.0.1'],
    // Hit by "Test all" to discover the exit IP and country of each proxy.
    testUrl: 'http://ip-api.com/json',
    /**
     * The pool. Each entry:
     * { id, label, protocol, host, port, enabled,
     *   auth: { enabled, username, password },
     *   health: { ok, ip, country, countryCode, latency, error, checkedAt } }
     */
    list: [],
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

/** Fill in the fields a hand-written or partial pool entry may be missing. */
export function normaliseProxyEntry(entry, index = 0) {
  const port = Number(entry?.port);
  return {
    id: entry?.id ?? randomUUID(),
    label: String(entry?.label ?? '').trim() || `Proxy ${index + 1}`,
    // Kept verbatim rather than coerced to http, so validateProxyEntry can say
    // "SOCKS is not supported" instead of the entry quietly misbehaving.
    protocol: String(entry?.protocol ?? 'http').toLowerCase(),
    host: String(entry?.host ?? '').trim(),
    port: Number.isFinite(port) && port > 0 ? port : 8080,
    enabled: entry?.enabled !== false,
    auth: {
      enabled: Boolean(entry?.auth?.enabled && entry?.auth?.username),
      username: entry?.auth?.username ?? '',
      password: entry?.auth?.password ?? '',
    },
    health: entry?.health ?? null,
  };
}

/**
 * Older installs stored a single proxy as `{ host, port, auth }`. Fold that into
 * the pool as its first entry so nobody loses a working configuration.
 */
function migrate(settings) {
  const proxy = settings.proxy ?? {};
  const list = Array.isArray(proxy.list) ? proxy.list : [];

  if (!list.length && proxy.host) {
    list.push(
      normaliseProxyEntry({
        label: 'Proxy 1',
        protocol: proxy.protocol,
        host: proxy.host,
        port: proxy.port,
        auth: proxy.auth,
        enabled: true,
      }),
    );
  }

  // Drop the single-proxy fields now that whatever they held lives in the pool.
  const { host, port, protocol, auth, ...rest } = proxy;

  return {
    ...settings,
    proxy: {
      ...rest,
      list: list.map((entry, index) => normaliseProxyEntry(entry, index)),
    },
  };
}

export async function getSettings() {
  const stored = await read('settings');
  return migrate(mergeDeep(DEFAULT_SETTINGS, Array.isArray(stored) ? {} : stored));
}

export async function saveSettings(patch) {
  const next = migrate(mergeDeep(await getSettings(), patch));
  await write('settings', next);
  return next;
}
