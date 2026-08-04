import { Buffer } from 'node:buffer';
import { fetch } from 'undici';

import { buildDispatcher } from './proxy.js';
import { getSettings } from './settings.js';

/**
 * Fetch an OAuth 2.0 access token. Supports the two grants that make sense
 * without a browser redirect: client credentials and resource-owner password.
 * The call goes through the configured proxy like any other request.
 */
export async function fetchAccessToken(config) {
  const {
    tokenUrl,
    grantType = 'client_credentials',
    clientId = '',
    clientSecret = '',
    scope = '',
    username = '',
    password = '',
    clientAuth = 'body', // 'body' | 'header'
    audience = '',
  } = config ?? {};

  if (!tokenUrl) return { error: 'Token URL is required' };

  const form = new URLSearchParams();
  form.set('grant_type', grantType);
  if (scope) form.set('scope', scope);
  if (audience) form.set('audience', audience);

  if (grantType === 'password') {
    form.set('username', username);
    form.set('password', password);
  }

  const headers = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };

  if (clientAuth === 'header' && clientId) {
    const raw = `${clientId}:${clientSecret}`;
    headers.Authorization = `Basic ${Buffer.from(raw).toString('base64')}`;
  } else {
    if (clientId) form.set('client_id', clientId);
    if (clientSecret) form.set('client_secret', clientSecret);
  }

  const settings = await getSettings();
  const { dispatcher } = buildDispatcher(settings, tokenUrl);

  try {
    const res = await fetch(tokenUrl, {
      method: 'POST',
      headers,
      body: form.toString(),
      dispatcher,
    });
    const text = await res.text();

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      return { error: `Token endpoint returned non-JSON (${res.status}): ${text.slice(0, 200)}` };
    }

    if (!res.ok) {
      const detail = payload.error_description ?? payload.error ?? text.slice(0, 200);
      return { error: `Token request failed (${res.status}): ${detail}` };
    }
    if (!payload.access_token) {
      return { error: 'Token endpoint response had no access_token' };
    }

    return {
      accessToken: payload.access_token,
      tokenType: payload.token_type ?? 'Bearer',
      expiresIn: payload.expires_in ?? null,
      refreshToken: payload.refresh_token ?? null,
      scope: payload.scope ?? scope,
      raw: payload,
    };
  } catch (err) {
    return { error: err.cause?.message ?? err.message };
  } finally {
    dispatcher?.close?.().catch(() => {});
  }
}
