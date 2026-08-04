import { Router } from 'express';

import { clearCookies, getCookies, setCookie } from '../lib/cookies.js';
import { fetchAccessToken } from '../lib/oauth.js';
import { getSettings, normaliseProxyEntry, saveSettings } from '../lib/settings.js';
import {
  clearProxyHealth,
  parseProxyList,
  proxyLabel,
  proxyUrlFor,
  validateProxyEntry,
} from '../lib/proxy.js';

export const toolsRouter = Router();

// --- settings (proxy, TLS, redirects, timeouts) ----------------------------
toolsRouter.get('/settings', async (_req, res) => {
  res.json(await getSettings());
});

toolsRouter.put('/settings', async (req, res) => {
  res.json(await saveSettings(req.body ?? {}));
});

const DEFAULT_TEST_URL = 'http://ip-api.com/json';

/**
 * Pull the exit IP and country out of whatever the test endpoint answered.
 * Understands ip-api.com, ipify and ipinfo, and shrugs at anything else.
 */
function readGeo(body) {
  try {
    const data = JSON.parse(body ?? '');
    const country = data.country ?? data.country_name ?? null;
    const countryCode = data.countryCode ?? data.country_code ?? (country ? null : data.country);
    return { ip: data.query ?? data.ip ?? null, country, countryCode: countryCode ?? null };
  } catch {
    return { ip: null, country: null, countryCode: null };
  }
}

/** Run one proxy against the test endpoint and describe what came back. */
async function checkProxy(entry, settings, target) {
  const invalid = validateProxyEntry(entry);
  if (invalid) {
    return { id: entry.id, label: proxyLabel(entry), ok: false, error: invalid, checkedAt: Date.now() };
  }

  const { sendRequest } = await import('../lib/http.js');
  const result = await sendRequest(
    { method: 'GET', url: target },
    {
      settings: { ...settings, cookies: { enabled: false } },
      cookies: false,
      // Force this exact proxy: no pool selection, no failing over to another
      // one, or a broken proxy would look healthy.
      proxy: entry,
    },
  );

  if (result.error) {
    return {
      id: entry.id,
      label: proxyLabel(entry),
      ok: false,
      error: result.error,
      checkedAt: Date.now(),
    };
  }

  return {
    id: entry.id,
    label: proxyLabel(entry),
    ok: result.status >= 200 && result.status < 400,
    status: result.status,
    latency: result.time,
    proxyUrl: proxyUrlFor(entry),
    ...readGeo(result.body),
    checkedAt: Date.now(),
  };
}

/**
 * Turn a pasted block of proxies into pool entries. Parsing lives on the server
 * so the UI and the pool agree on what a proxy line means.
 */
toolsRouter.post('/settings/parse-proxies', async (req, res) => {
  const entries = parseProxyList(req.body?.text ?? '', Number(req.body?.startIndex) || 0);
  res.json({ entries });
});

/** Test the whole pool at once — every proxy in parallel. */
toolsRouter.post('/settings/test-proxies', async (req, res) => {
  const settings = await getSettings();
  const source = Array.isArray(req.body?.proxies) ? req.body.proxies : settings.proxy.list;
  const entries = (source ?? []).map((entry, index) => normaliseProxyEntry(entry, index));
  if (!entries.length) return res.json({ results: [] });

  const target = req.body?.url || settings.proxy.testUrl || DEFAULT_TEST_URL;
  // A dead proxy from an earlier run should not be skipped by this check.
  clearProxyHealth();
  const results = await Promise.all(entries.map((entry) => checkProxy(entry, settings, target)));
  res.json({ results, testUrl: target });
});

/** Check a single proxy — same thing, one entry. */
toolsRouter.post('/settings/test-proxy', async (req, res) => {
  const settings = await getSettings();
  const entry = normaliseProxyEntry(req.body?.proxy ?? {});
  if (!entry.host) return res.json({ ok: false, error: 'This proxy has no host' });
  const target = req.body?.url || settings.proxy.testUrl || DEFAULT_TEST_URL;
  res.json(await checkProxy(entry, settings, target));
});

// --- cookie jar ------------------------------------------------------------
toolsRouter.get('/cookies', async (_req, res) => {
  res.json(await getCookies());
});

toolsRouter.post('/cookies', async (req, res) => {
  const { name, value, domain } = req.body ?? {};
  if (!name || !domain) return res.status(400).json({ error: 'name and domain are required' });
  await setCookie({ name, value: value ?? '', domain, ...req.body });
  res.status(201).json(await getCookies());
});

toolsRouter.delete('/cookies', async (req, res) => {
  await clearCookies(req.query.domain);
  res.json({ ok: true });
});

// --- oauth 2.0 -------------------------------------------------------------
toolsRouter.post('/oauth/token', async (req, res) => {
  const result = await fetchAccessToken(req.body ?? {});
  if (result.error) return res.status(400).json(result);
  res.json(result);
});
