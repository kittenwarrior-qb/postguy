import { useEffect, useState } from 'react';

import { api } from '../lib/api.js';
import { useStore } from '../store/useStore.js';

export function CookiesModal({ onClose }) {
  const notify = useStore((state) => state.notify);
  const [cookies, setCookies] = useState([]);
  const [draft, setDraft] = useState({ name: '', value: '', domain: '', path: '/' });

  const load = () => api.listCookies().then(setCookies).catch((err) => notify(err.message, 'error'));

  useEffect(() => {
    load();
  }, []);

  const add = async () => {
    if (!draft.name || !draft.domain) {
      notify('Name and domain are required', 'error');
      return;
    }
    await api.addCookie(draft);
    setDraft({ name: '', value: '', domain: '', path: '/' });
    load();
  };

  const clearAll = async () => {
    if (!confirm('Clear every cookie in the jar?')) return;
    await api.clearCookies();
    load();
  };

  const clearDomain = async (domain) => {
    await api.clearCookies(domain);
    load();
  };

  const domains = [...new Set(cookies.map((cookie) => cookie.domain))].sort();

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Cookies</span>
          <button type="button" className="btn ghost small" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <p className="hint" style={{ marginTop: 0 }}>
            Cookies captured from responses are sent back automatically on matching requests — that
            is what keeps you logged in after hitting a login endpoint.
          </p>

          {!cookies.length && <p className="empty-hint">The jar is empty.</p>}

          {domains.map((domain) => (
            <div key={domain} style={{ marginBottom: 14 }}>
              <div className="cookie-domain">
                <strong>{domain}</strong>
                <button type="button" className="btn ghost small" onClick={() => clearDomain(domain)}>
                  Clear
                </button>
              </div>
              <table className="headers-table">
                <tbody>
                  {cookies
                    .filter((cookie) => cookie.domain === domain)
                    .map((cookie) => (
                      <tr key={`${cookie.name}-${cookie.path}`}>
                        <td>{cookie.name}</td>
                        <td>
                          {cookie.value}
                          <div className="hint">
                            path={cookie.path}
                            {cookie.httpOnly ? ' · HttpOnly' : ''}
                            {cookie.secure ? ' · Secure' : ''}
                            {cookie.expires
                              ? ` · expires ${new Date(cookie.expires).toLocaleString()}`
                              : ' · session'}
                          </div>
                        </td>
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          ))}

          <h4 className="settings-heading">Add a cookie</h4>
          <div className="settings-grid">
            <label>
              Name
              <input
                type="text"
                value={draft.name}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            <label>
              Value
              <input
                type="text"
                value={draft.value}
                onChange={(e) => setDraft({ ...draft, value: e.target.value })}
              />
            </label>
            <label>
              Domain
              <input
                type="text"
                placeholder="example.com"
                value={draft.domain}
                onChange={(e) => setDraft({ ...draft, domain: e.target.value })}
              />
            </label>
            <label>
              Path
              <input
                type="text"
                value={draft.path}
                onChange={(e) => setDraft({ ...draft, path: e.target.value })}
              />
            </label>
          </div>
          <button type="button" className="btn small" style={{ marginTop: 10 }} onClick={add}>
            Add cookie
          </button>
        </div>

        <div className="modal-foot">
          <button type="button" className="btn" onClick={clearAll} disabled={!cookies.length}>
            Clear all
          </button>
          <button type="button" className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}
