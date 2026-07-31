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
};
