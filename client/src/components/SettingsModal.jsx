import { useEffect, useState } from 'react';

import { ProxyPool } from './ProxyPool.jsx';
import { api } from '../lib/api.js';
import { useStore } from '../store/useStore.js';

export function SettingsModal({ onClose }) {
  const notify = useStore((state) => state.notify);
  const [settings, setSettings] = useState(null);

  useEffect(() => {
    api.getSettings().then(setSettings).catch((err) => notify(err.message, 'error'));
  }, [notify]);

  if (!settings) {
    return (
      <div className="modal-backdrop" onClick={onClose}>
        <div className="modal wide" onClick={(e) => e.stopPropagation()}>
          <div className="modal-body">Loading settings…</div>
        </div>
      </div>
    );
  }

  const patchRequest = (patch) =>
    setSettings((prev) => ({ ...prev, request: { ...prev.request, ...patch } }));

  const save = async () => {
    await api.saveSettings(settings);
    notify('Settings saved');
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal wide" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Settings</span>
          <button type="button" className="btn ghost small" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <h4 className="settings-heading">Proxy pool</h4>
          <p className="hint" style={{ marginTop: 0 }}>
            Requests are spread across the proxies below, so a rate limit counted per IP is spread
            too. HTTPS goes through <code>CONNECT</code>, so an intercepting proxy works here as
            well — add it as the only entry.
          </p>

          <ProxyPool
            proxy={settings.proxy}
            onChange={(proxy) => setSettings((prev) => ({ ...prev, proxy }))}
          />

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
