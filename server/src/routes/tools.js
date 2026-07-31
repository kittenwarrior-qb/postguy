import { Router } from 'express';

import { clearCookies, getCookies, setCookie } from '../lib/cookies.js';
import { fetchAccessToken } from '../lib/oauth.js';
import { getSettings, saveSettings } from '../lib/settings.js';
import { proxyUrlFor } from '../lib/proxy.js';

export const toolsRouter = Router();

// --- settings (proxy, TLS, redirects, timeouts) ----------------------------
toolsRouter.get('/settings', async (_req, res) => {
  res.json(await getSettings());
});

toolsRouter.put('/settings', async (req, res) => {
  res.json(await saveSettings(req.body ?? {}));
});

/** Check the proxy is reachable before you rely on it for real requests. */
toolsRouter.post('/settings/test-proxy', async (req, res) => {
  const settings = await saveSettings({});
  const merged = { ...settings, proxy: { ...settings.proxy, ...(req.body?.proxy ?? {}) } };
  const proxyUrl = proxyUrlFor(merged);
  if (!proxyUrl) return res.json({ ok: false, error: 'Proxy is not enabled or has no host' });

  const target = req.body?.url || 'http://example.com';
  const { sendRequest } = await import('../lib/http.js');
  const result = await sendRequest(
    { method: 'GET', url: target },
    { settings: { ...merged, cookies: { enabled: false } }, cookies: false },
  );

  if (result.error) return res.json({ ok: false, proxyUrl, error: result.error });
  res.json({ ok: true, proxyUrl, status: result.status, time: result.time });
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
