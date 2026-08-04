import { Buffer } from 'node:buffer';
import { Agent, ProxyAgent } from 'undici';

import { normaliseProxyEntry } from './settings.js';

/**
 * The proxy pool.
 *
 * A request picks one proxy out of the pool according to the configured
 * strategy, and `orderedProxiesFor()` returns the rest behind it so the caller
 * can retry down the list when a proxy is refusing connections.
 */

/** Round-robin cursor. Module-level, so it advances across requests. */
let cursor = 0;

/**
 * Proxies that just failed to connect, so the next request skips them instead
 * of paying the same timeout again. In memory only — a restart forgets it, and
 * so does "Test all".
 */
const downUntil = new Map();
const DOWN_FOR_MS = 60_000;

export function markProxyDown(id) {
  if (id) downUntil.set(id, Date.now() + DOWN_FOR_MS);
}

export function markProxyUp(id) {
  if (id) downUntil.delete(id);
}

export function clearProxyHealth() {
  downUntil.clear();
}

function isDown(entry) {
  const until = downUntil.get(entry.id);
  if (!until) return false;
  if (until <= Date.now()) {
    downUntil.delete(entry.id);
    return false;
  }
  return true;
}

// --- parsing ---------------------------------------------------------------

/**
 * Parse one proxy line. Accepts the formats people actually paste:
 *
 *   host:port
 *   host:port:user:pass
 *   user:pass@host:port
 *   http://user:pass@host:port
 *   https://host:port            # label
 */
export function parseProxyLine(line) {
  let text = String(line ?? '').trim();
  if (!text || text.startsWith('//')) return null;

  let label = '';
  const hash = text.indexOf('#');
  if (hash !== -1) {
    label = text.slice(hash + 1).trim();
    text = text.slice(0, hash).trim();
  }
  if (!text) return null;

  let protocol = 'http';
  const scheme = text.match(/^(https?|socks5?):\/\//i);
  if (scheme) {
    // SOCKS is parsed so the line is not silently dropped, but undici's
    // ProxyAgent only speaks HTTP — validateProxyEntry rejects it with a clear
    // message rather than failing later on every request.
    protocol = scheme[1].toLowerCase();
    text = text.slice(scheme[0].length);
  }

  let username = '';
  let password = '';
  const at = text.lastIndexOf('@');
  if (at !== -1) {
    const credentials = text.slice(0, at);
    text = text.slice(at + 1);
    const split = credentials.indexOf(':');
    username = split === -1 ? credentials : credentials.slice(0, split);
    password = split === -1 ? '' : credentials.slice(split + 1);
  }

  const parts = text.split(':').filter((part) => part !== '');
  if (parts.length < 2) return null;

  const [host, rawPort, user, pass] = parts;
  // host:port:user:pass — the format most proxy sellers hand out.
  if (!username && user) {
    username = user;
    password = pass ?? '';
  }

  const port = Number(rawPort);
  if (!host || !Number.isFinite(port) || port <= 0 || port > 65535) return null;

  return {
    label,
    protocol,
    host,
    port,
    auth: { enabled: Boolean(username), username, password },
  };
}

/** Parse a pasted block — one proxy per line — into pool entries. */
export function parseProxyList(text, startIndex = 0) {
  const out = [];
  for (const line of String(text ?? '').split(/[\r\n,]+/)) {
    const parsed = parseProxyLine(line);
    if (!parsed) continue;
    out.push(
      normaliseProxyEntry(
        { ...parsed, label: parsed.label || `${parsed.host}:${parsed.port}` },
        startIndex + out.length,
      ),
    );
  }
  return out;
}

/** @returns {string|null} an error message, or null when the entry is usable. */
export function validateProxyEntry(entry) {
  if (!entry?.host) return 'Missing host';
  if (entry.protocol !== 'http' && entry.protocol !== 'https') {
    return `${entry.protocol.toUpperCase()} proxies are not supported — use an HTTP or HTTPS proxy`;
  }
  return null;
}

export function proxyUrlFor(entry) {
  if (!entry?.host) return null;
  const protocol = entry.protocol === 'https' ? 'https' : 'http';
  return `${protocol}://${entry.host}:${entry.port || 8080}`;
}

export function proxyLabel(entry) {
  if (!entry) return null;
  return entry.label || `${entry.host}:${entry.port}`;
}

// --- selection -------------------------------------------------------------

function hostIsBypassed(hostname, bypass) {
  const host = hostname.toLowerCase();
  return (bypass ?? []).some((entry) => {
    const rule = String(entry).trim().toLowerCase();
    if (!rule) return false;
    if (rule === '*') return true;
    if (rule.startsWith('*.')) return host === rule.slice(2) || host.endsWith(rule.slice(1));
    if (rule.startsWith('.')) return host === rule.slice(1) || host.endsWith(rule);
    return host === rule;
  });
}

/** Every entry that is switched on and actually usable. */
export function usableProxies(settings) {
  const proxy = settings?.proxy;
  if (!proxy?.enabled) return [];
  return (proxy.list ?? []).filter((entry) => entry.enabled !== false && !validateProxyEntry(entry));
}

function hashHost(hostname) {
  let hash = 0;
  for (let i = 0; i < hostname.length; i += 1) hash = (hash * 31 + hostname.charCodeAt(i)) >>> 0;
  return hash;
}

/**
 * The proxies to try for one request, best first. An empty array means "go
 * direct" — the proxy is off, the host is on the bypass list, or the pool is
 * empty.
 */
export function orderedProxiesFor(settings, targetUrl) {
  const pool = usableProxies(settings);
  if (!pool.length) return [];

  let hostname = '';
  try {
    hostname = new URL(targetUrl).hostname;
  } catch {
    return []; // the caller validates the URL; fall through to a direct agent
  }
  if (!hostname || hostIsBypassed(hostname, settings.proxy.bypass)) return [];

  // Proxies known to be down go to the back rather than out — if every proxy
  // is marked down we still try, instead of silently going direct.
  const healthy = pool.filter((entry) => !isDown(entry));
  const candidates = healthy.length ? healthy : pool;

  let start = 0;
  switch (settings.proxy.strategy) {
    case 'random':
      start = Math.floor(Math.random() * candidates.length);
      break;
    case 'sticky':
      // Same host, same exit IP — a session that logs in stays logged in.
      start = hashHost(hostname) % candidates.length;
      break;
    case 'first':
      start = 0;
      break;
    case 'round-robin':
    default:
      start = cursor % candidates.length;
      cursor = (cursor + 1) % candidates.length;
      break;
  }

  const ordered = [...candidates.slice(start), ...candidates.slice(0, start)];
  // Down proxies stay available as a last resort, after the healthy ones.
  if (healthy.length) ordered.push(...pool.filter((entry) => isDown(entry)));
  return ordered;
}

// --- dispatchers -----------------------------------------------------------

/**
 * Build the undici dispatcher for one attempt: a ProxyAgent when `entry` is
 * given, otherwise a plain Agent. Both honour the TLS-verification and timeout
 * settings. The caller owns the returned dispatcher and must close it.
 */
export function buildDispatcher(settings, entry) {
  const verifySsl = settings?.request?.verifySsl !== false;
  const timeout = settings?.request?.timeout ?? 60000;

  const connect = {
    // `rejectUnauthorized: false` is the "accept self-signed certs" escape
    // hatch every API client has; it is opt-in from Settings.
    rejectUnauthorized: verifySsl,
    timeout,
  };

  const proxyUrl = entry ? proxyUrlFor(entry) : null;
  if (!proxyUrl) {
    return new Agent({ connect, headersTimeout: timeout, bodyTimeout: timeout });
  }

  const options = {
    uri: proxyUrl,
    connect,
    requestTls: connect,
    proxyTls: { ...connect },
    headersTimeout: timeout,
    bodyTimeout: timeout,
  };

  if (entry.auth?.enabled && entry.auth.username) {
    const raw = `${entry.auth.username}:${entry.auth.password ?? ''}`;
    options.token = `Basic ${Buffer.from(raw).toString('base64')}`;
  }

  return new ProxyAgent(options);
}
