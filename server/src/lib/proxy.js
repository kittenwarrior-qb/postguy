import { Buffer } from 'node:buffer';
import { Agent, ProxyAgent } from 'undici';

/**
 * Builds the undici dispatcher for a request: an upstream proxy when one is
 * configured (with Proxy-Authorization if it needs a login), otherwise a plain
 * agent. Both honour the TLS-verification and timeout settings.
 */

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

export function proxyUrlFor(settings) {
  const proxy = settings?.proxy;
  if (!proxy?.enabled || !proxy.host) return null;
  const protocol = proxy.protocol === 'https' ? 'https' : 'http';
  return `${protocol}://${proxy.host}:${proxy.port || 8080}`;
}

/**
 * @returns {{ dispatcher: import('undici').Dispatcher | null, viaProxy: boolean }}
 */
export function buildDispatcher(settings, targetUrl) {
  const verifySsl = settings?.request?.verifySsl !== false;
  const timeout = settings?.request?.timeout ?? 60000;

  const connect = {
    // `rejectUnauthorized: false` is the "accept self-signed certs" escape
    // hatch every API client has; it is opt-in from Settings.
    rejectUnauthorized: verifySsl,
    timeout,
  };

  const proxyUrl = proxyUrlFor(settings);
  let hostname = '';
  try {
    hostname = new URL(targetUrl).hostname;
  } catch {
    /* the caller validates the URL; fall through to a direct agent */
  }

  if (proxyUrl && hostname && !hostIsBypassed(hostname, settings.proxy.bypass)) {
    const options = {
      uri: proxyUrl,
      connect,
      requestTls: connect,
      proxyTls: { ...connect },
      headersTimeout: timeout,
      bodyTimeout: timeout,
    };

    const auth = settings.proxy.auth;
    if (auth?.enabled && auth.username) {
      const raw = `${auth.username}:${auth.password ?? ''}`;
      options.token = `Basic ${Buffer.from(raw).toString('base64')}`;
    }

    return { dispatcher: new ProxyAgent(options), viaProxy: true };
  }

  return {
    dispatcher: new Agent({ connect, headersTimeout: timeout, bodyTimeout: timeout }),
    viaProxy: false,
  };
}
