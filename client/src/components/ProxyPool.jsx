import { useState } from 'react';

import { api } from '../lib/api.js';
import { useStore } from '../store/useStore.js';

const STRATEGIES = [
  { id: 'round-robin', label: 'Round-robin', hint: 'One request each, in order' },
  { id: 'sticky', label: 'Sticky per host', hint: 'Same host always exits from the same IP' },
  { id: 'random', label: 'Random', hint: 'Pick one at random every time' },
  { id: 'first', label: 'First healthy', hint: 'Always the top one; the rest are spares' },
];

const PLACEHOLDER = `host:port
host:port:user:pass
user:pass@host:port
http://user:pass@host:port    # US-East`;

/** 'US' → 🇺🇸 — the two letters offset into the regional-indicator block. */
function flag(code) {
  if (!code || code.length !== 2) return '';
  const base = 0x1f1e6 - 'A'.charCodeAt(0);
  return String.fromCodePoint(...[...code.toUpperCase()].map((c) => c.charCodeAt(0) + base));
}

function HealthCell({ health, busy }) {
  if (busy) return <span className="hint">Testing…</span>;
  if (!health) return <span className="hint">Not tested</span>;

  if (!health.ok) {
    return (
      <span className="proxy-health bad" title={health.error}>
        <span className="dot" />
        {health.error ?? 'Failed'}
      </span>
    );
  }

  return (
    <span className="proxy-health good" title={`Checked ${new Date(health.checkedAt).toLocaleTimeString()}`}>
      <span className="dot" />
      {health.countryCode && <strong>{flag(health.countryCode)} {health.countryCode}</strong>}
      {health.ip && <code>{health.ip}</code>}
      {health.latency != null && <span className="hint">{health.latency} ms</span>}
    </span>
  );
}

export function ProxyPool({ proxy, onChange }) {
  const notify = useStore((state) => state.notify);
  const [paste, setPaste] = useState('');
  const [showPaste, setShowPaste] = useState(false);
  const [testing, setTesting] = useState(null); // null | 'all' | entry id

  const list = proxy.list ?? [];
  const online = list.filter((entry) => entry.health?.ok).length;
  const active = list.filter((entry) => entry.enabled !== false).length;
  // undici only speaks to HTTP proxies, so a pasted SOCKS line would be skipped
  // silently — say so instead.
  const unsupported = list.filter(
    (entry) => entry.protocol && entry.protocol !== 'http' && entry.protocol !== 'https',
  );

  const patch = (updates) => onChange({ ...proxy, ...updates });
  const setList = (next) => patch({ list: next });
  const patchEntry = (id, updates) =>
    setList(list.map((entry) => (entry.id === id ? { ...entry, ...updates } : entry)));

  const addBlank = () =>
    setList([
      ...list,
      {
        id: `new-${Date.now()}`,
        label: `Proxy ${list.length + 1}`,
        protocol: 'http',
        host: '',
        port: 8080,
        enabled: true,
        auth: { enabled: false, username: '', password: '' },
        health: null,
      },
    ]);

  const addPasted = async () => {
    if (!paste.trim()) return;
    try {
      // The server owns the parsing so the UI and the pool never disagree
      // about what a proxy line means.
      const { entries } = await api.parseProxies({ text: paste, startIndex: list.length });
      if (!entries.length) {
        notify('No proxy could be read from that text', 'error');
        return;
      }
      setList([...list, ...entries]);
      setPaste('');
      setShowPaste(false);
      notify(`Added ${entries.length} prox${entries.length === 1 ? 'y' : 'ies'}`);
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const testAll = async () => {
    if (!list.length) return;
    setTesting('all');
    try {
      const { results } = await api.testProxies({ proxies: list, url: proxy.testUrl });
      const byId = new Map(results.map((result) => [result.id, result]));
      setList(list.map((entry) => ({ ...entry, health: byId.get(entry.id) ?? entry.health })));
      const ok = results.filter((result) => result.ok).length;
      notify(`${ok}/${results.length} proxies responded`, ok ? 'info' : 'error');
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setTesting(null);
    }
  };

  const testOne = async (entry) => {
    setTesting(entry.id);
    try {
      const result = await api.testProxy({ proxy: entry, url: proxy.testUrl });
      patchEntry(entry.id, { health: result });
    } catch (err) {
      notify(err.message, 'error');
    } finally {
      setTesting(null);
    }
  };

  return (
    <>
      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={proxy.enabled}
          onChange={(e) => patch({ enabled: e.target.checked })}
        />
        Route requests through the proxy pool
      </label>

      <div className="settings-grid" data-disabled={!proxy.enabled}>
        <label style={{ gridColumn: 'span 2' }}>
          Rotation
          <select
            value={proxy.strategy ?? 'round-robin'}
            disabled={!proxy.enabled}
            onChange={(e) => patch({ strategy: e.target.value })}
          >
            {STRATEGIES.map((option) => (
              <option key={option.id} value={option.id}>
                {option.label} — {option.hint}
              </option>
            ))}
          </select>
        </label>
        <label style={{ gridColumn: 'span 2' }}>
          Test endpoint
          <input
            type="text"
            placeholder="http://ip-api.com/json"
            value={proxy.testUrl ?? ''}
            disabled={!proxy.enabled}
            onChange={(e) => patch({ testUrl: e.target.value })}
          />
        </label>
      </div>

      <label className="checkbox-row">
        <input
          type="checkbox"
          checked={proxy.failover !== false}
          disabled={!proxy.enabled}
          onChange={(e) => patch({ failover: e.target.checked })}
        />
        Retry on the next proxy when one will not connect
      </label>

      <div className="proxy-toolbar">
        <span className="hint">
          {list.length} in the pool · {active} on
          {online > 0 && <> · {online} answered</>}
        </span>
        <button
          type="button"
          className="btn small"
          onClick={testAll}
          disabled={!list.length || testing === 'all'}
        >
          {testing === 'all' ? 'Testing…' : 'Test all'}
        </button>
        <button type="button" className="btn small" onClick={() => setShowPaste((on) => !on)}>
          Paste a list
        </button>
        <button type="button" className="btn small" onClick={addBlank}>
          Add one
        </button>
        {list.length > 0 && (
          <button
            type="button"
            className="btn small ghost"
            onClick={() => {
              if (confirm(`Remove all ${list.length} proxies from the pool?`)) setList([]);
            }}
          >
            Clear
          </button>
        )}
      </div>

      {showPaste && (
        <div className="proxy-paste">
          <textarea
            rows={5}
            placeholder={PLACEHOLDER}
            value={paste}
            onChange={(e) => setPaste(e.target.value)}
          />
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <button type="button" className="btn small primary" onClick={addPasted}>
              Add to pool
            </button>
            <span className="hint">
              One per line. Text after <code>#</code> becomes the label.
            </span>
          </div>
        </div>
      )}

      {unsupported.length > 0 && (
        <p className="hint" style={{ color: 'var(--yellow)' }}>
          {unsupported.length} entr{unsupported.length === 1 ? 'y is' : 'ies are'} using{' '}
          {[...new Set(unsupported.map((entry) => entry.protocol.toUpperCase()))].join('/')}, which
          this client cannot dial — those are skipped. Use HTTP or HTTPS proxies.
        </p>
      )}

      {!list.length ? (
        <p className="empty-hint">
          The pool is empty. Paste a list of proxies and every request will be spread across them.
        </p>
      ) : (
        <table className="proxy-table">
          <thead>
            <tr>
              <th />
              <th>Label</th>
              <th>Host</th>
              <th>Port</th>
              <th>User</th>
              <th>Password</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {list.map((entry) => (
              <tr key={entry.id} data-off={entry.enabled === false}>
                <td>
                  <input
                    type="checkbox"
                    checked={entry.enabled !== false}
                    title="Use this proxy"
                    onChange={(e) => patchEntry(entry.id, { enabled: e.target.checked })}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={entry.label ?? ''}
                    onChange={(e) => patchEntry(entry.id, { label: e.target.value })}
                  />
                </td>
                <td>
                  <input
                    type="text"
                    className="mono"
                    placeholder="1.2.3.4"
                    value={entry.host ?? ''}
                    onChange={(e) => patchEntry(entry.id, { host: e.target.value, health: null })}
                  />
                </td>
                <td>
                  <input
                    type="number"
                    className="mono narrow"
                    value={entry.port ?? 8080}
                    onChange={(e) =>
                      patchEntry(entry.id, { port: Number(e.target.value), health: null })
                    }
                  />
                </td>
                <td>
                  <input
                    type="text"
                    value={entry.auth?.username ?? ''}
                    onChange={(e) =>
                      patchEntry(entry.id, {
                        auth: {
                          ...entry.auth,
                          username: e.target.value,
                          enabled: Boolean(e.target.value),
                        },
                        health: null,
                      })
                    }
                  />
                </td>
                <td>
                  <input
                    type="password"
                    value={entry.auth?.password ?? ''}
                    onChange={(e) =>
                      patchEntry(entry.id, {
                        auth: { ...entry.auth, password: e.target.value },
                        health: null,
                      })
                    }
                  />
                </td>
                <td>
                  <HealthCell health={entry.health} busy={testing === entry.id} />
                </td>
                <td className="proxy-row-actions">
                  <button
                    type="button"
                    className="btn ghost small"
                    title="Test this proxy"
                    onClick={() => testOne(entry)}
                    disabled={testing !== null}
                  >
                    ↻
                  </button>
                  <button
                    type="button"
                    className="btn ghost small"
                    title="Remove"
                    onClick={() => setList(list.filter((item) => item.id !== entry.id))}
                  >
                    ×
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <label className="field">
        Bypass the pool for these hosts (comma separated)
        <input
          type="text"
          placeholder="localhost, 127.0.0.1, *.internal"
          value={(proxy.bypass ?? []).join(', ')}
          disabled={!proxy.enabled}
          onChange={(e) =>
            patch({
              bypass: e.target.value
                .split(',')
                .map((entry) => entry.trim())
                .filter(Boolean),
            })
          }
        />
      </label>
    </>
  );
}
