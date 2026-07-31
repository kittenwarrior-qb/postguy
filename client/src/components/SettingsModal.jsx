import { useEffect, useState } from 'react';

import { api } from '../lib/api.js';
import { useStore } from '../store/useStore.js';

export function SettingsModal({ onClose }) {
  const notify = useStore((state) => state.notify);
  const [settings, setSettings] = useState(null);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState(null);

  useEffect(() => {
    api.getSettings().then(setSettings).catch((err) => notify(err.message, 'error'));
  }, [notify]);

  if (!settings) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal" onClick={(e) => e.stopPropagation()}>
          <div className="modal-body">Loading settings…</div>
        </div>
      </div>
    );
  }

  const patchProxy = (patch) =>
    setSettings((prev) => ({ ...prev, proxy: { ...prev.proxy, ...patch } }));
  const patchProxyAuth = (patch) =>
    setSettings((prev) => ({
      ...prev,
      proxy: { ...prev.proxy, auth: { ...prev.proxy.auth, ...patch } },
    }));
  const patchRequest = (patch) =>
    setSettings((prev) => ({ ...prev, request: { ...prev.request, ...patch } }));

  const save = async () => {
    await api.saveSettings(settings);
    notify('Settings saved');
    onClose();
  };

  const test = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const result = await api.testProxy({ proxy: settings.proxy });
      setTestResult(result);
    } catch (err) {
      setTestResult({ ok: false, error: err.message });
    } finally {
      setTesting(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Settings</span>
          <button type="button" className="btn ghost small" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <h4 className="settings-heading">Proxy</h4>
          <p className="hint" style={{ marginTop: 0 }}>
            Send every request through an upstream HTTP proxy — useful for routing traffic into an
            intercepting proxy, or through a corporate gateway that needs a login.
          </p>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.proxy.enabled}
              onChange={(e) => patchProxy({ enabled: e.target.checked })}
            />
            Use a proxy server
          </label>

          <div className="settings-grid" data-disabled={!settings.proxy.enabled}>
            <label>
              Protocol
              <select
                value={settings.proxy.protocol}
                disabled={!settings.proxy.enabled}
                onChange={(e) => patchProxy({ protocol: e.target.value })}
              >
                <option value="http">http</option>
                <option value="https">https</option>
              </select>
            </label>
            <label style={{ gridColumn: 'span 2' }}>
              Host
              <input
                type="text"
                placeholder="127.0.0.1"
                value={settings.proxy.host}
                disabled={!settings.proxy.enabled}
                onChange={(e) => patchProxy({ host: e.target.value })}
              />
            </label>
            <label>
              Port
              <input
                type="number"
                value={settings.proxy.port}
                disabled={!settings.proxy.enabled}
                onChange={(e) => patchProxy({ port: Number(e.target.value) })}
              />
            </label>
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.proxy.auth.enabled}
              disabled={!settings.proxy.enabled}
              onChange={(e) => patchProxyAuth({ enabled: e.target.checked })}
            />
            This proxy requires a login
          </label>

          {settings.proxy.auth.enabled && (
            <div className="settings-grid">
              <label style={{ gridColumn: 'span 2' }}>
                Proxy username
                <input
                  type="text"
                  value={settings.proxy.auth.username}
                  disabled={!settings.proxy.enabled}
                  onChange={(e) => patchProxyAuth({ username: e.target.value })}
                />
              </label>
              <label style={{ gridColumn: 'span 2' }}>
                Proxy password
                <input
                  type="password"
                  value={settings.proxy.auth.password}
                  disabled={!settings.proxy.enabled}
                  onChange={(e) => patchProxyAuth({ password: e.target.value })}
                />
              </label>
            </div>
          )}

          <label className="field">
            Bypass the proxy for these hosts (comma separated)
            <input
              type="text"
              placeholder="localhost, 127.0.0.1, *.internal"
              value={(settings.proxy.bypass ?? []).join(', ')}
              disabled={!settings.proxy.enabled}
              onChange={(e) =>
                patchProxy({
                  bypass: e.target.value
                    .split(',')
                    .map((entry) => entry.trim())
                    .filter(Boolean),
                })
              }
            />
          </label>

          <div style={{ display: 'flex', alignItems: 'center', gap: 10, margin: '10px 0 18px' }}>
            <button
              type="button"
              className="btn small"
              onClick={test}
              disabled={!settings.proxy.enabled || testing}
            >
              {testing ? 'Testing…' : 'Test proxy connection'}
            </button>
            {testResult && (
              <span
                className="hint"
                style={{ color: testResult.ok ? 'var(--green)' : 'var(--red)' }}
              >
                {testResult.ok
                  ? `Reached ${testResult.proxyUrl} — got ${testResult.status} in ${testResult.time} ms`
                  : testResult.error}
              </span>
            )}
          </div>

          <h4 className="settings-heading">Requests</h4>
          <div className="settings-grid">
            <label style={{ gridColumn: 'span 2' }}>
              Timeout (ms)
              <input
                type="number"
                value={settings.request.timeout}
                onChange={(e) => patchRequest({ timeout: Number(e.target.value) })}
              />
            </label>
            <label style={{ gridColumn: 'span 2' }}>
              Max redirects
              <input
                type="number"
                value={settings.request.maxRedirects}
                onChange={(e) => patchRequest({ maxRedirects: Number(e.target.value) })}
              />
            </label>
          </div>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.request.followRedirects}
              onChange={(e) => patchRequest({ followRedirects: e.target.checked })}
            />
            Follow redirects automatically
          </label>

          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.request.verifySsl}
              onChange={(e) => patchRequest({ verifySsl: e.target.checked })}
            />
            Verify TLS certificates
          </label>
          {!settings.request.verifySsl && (
            <p className="hint" style={{ color: 'var(--yellow)', marginTop: 0 }}>
              Certificate verification is off. Handy for a dev server with a self-signed
              certificate — don't leave it off against anything you actually care about.
            </p>
          )}

          <h4 className="settings-heading">Cookies</h4>
          <label className="checkbox-row">
            <input
              type="checkbox"
              checked={settings.cookies.enabled}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  cookies: { ...prev.cookies, enabled: e.target.checked },
                }))
              }
            />
            Keep a cookie jar (log in once, stay logged in on later requests)
          </label>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn primary" onClick={save}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}
