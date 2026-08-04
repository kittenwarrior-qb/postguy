const BASE = '/api';

async function request(path, options = {}) {
  const res = await fetch(`${BASE}${path}`, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (!res.ok) {
    const detail = await res.json().catch(() => ({}));
    throw new Error(detail.error ?? `${res.status} ${res.statusText}`);
  }
  return res.json();
}

export const api = {
  send: (payload) => request('/send', { method: 'POST', body: payload }),
  runCollection: (payload) => request('/run', { method: 'POST', body: payload }),

  listCollections: () => request('/collections'),
  createCollection: (body) => request('/collections', { method: 'POST', body }),
  updateCollection: (id, body) => request(`/collections/${id}`, { method: 'PUT', body }),
  deleteCollection: (id) => request(`/collections/${id}`, { method: 'DELETE' }),

  listEnvironments: () => request('/environments'),
  createEnvironment: (body) => request('/environments', { method: 'POST', body }),
  updateEnvironment: (id, body) => request(`/environments/${id}`, { method: 'PUT', body }),
  deleteEnvironment: (id) => request(`/environments/${id}`, { method: 'DELETE' }),

  listHistory: () => request('/history'),
  clearHistory: () => request('/history', { method: 'DELETE' }),

  getSettings: () => request('/settings'),
  saveSettings: (body) => request('/settings', { method: 'PUT', body }),
  testProxy: (body) => request('/settings/test-proxy', { method: 'POST', body }),
  testProxies: (body) => request('/settings/test-proxies', { method: 'POST', body }),
  parseProxies: (body) => request('/settings/parse-proxies', { method: 'POST', body }),

  listCookies: () => request('/cookies'),
  addCookie: (body) => request('/cookies', { method: 'POST', body }),
  clearCookies: (domain) =>
    request(`/cookies${domain ? `?domain=${encodeURIComponent(domain)}` : ''}`, {
      method: 'DELETE',
    }),

  getOAuthToken: (body) => request('/oauth/token', { method: 'POST', body }),

  listJobs: () => request('/jobs'),
  startJob: (body) => request('/jobs', { method: 'POST', body }),
  getJob: (id) => request(`/jobs/${id}`),
  stopJob: (id) => request(`/jobs/${id}`, { method: 'DELETE' }),
  /** SSE endpoint — opened with EventSource, not fetch. */
  jobEventsUrl: (id) => `${BASE}/jobs/${id}/events`,
};
