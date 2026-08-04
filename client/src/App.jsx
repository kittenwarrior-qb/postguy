import { useEffect, useState } from 'react';

import { CookiesModal } from './components/CookiesModal.jsx';
import { EnvironmentModal } from './components/EnvironmentModal.jsx';
import { RequestPanel } from './components/RequestPanel.jsx';
import { ScriptTab } from './components/ScriptTab.jsx';
import { SettingsModal } from './components/SettingsModal.jsx';
import { ResponsePanel } from './components/ResponsePanel.jsx';
import { RunnerModal } from './components/RunnerModal.jsx';
import { Sidebar } from './components/Sidebar.jsx';
import { api } from './lib/api.js';
import {
  METHODS,
  METHOD_COLORS,
  buildUrlWithParams,
  paramsFromUrl,
  urlWithoutQuery,
} from './lib/request.js';
import { useStore } from './store/useStore.js';

function TabStrip() {
  const tabs = useStore((state) => state.tabs);
  const activeTabId = useStore((state) => state.activeTabId);
  const setActiveTab = useStore((state) => state.setActiveTab);
  const closeTab = useStore((state) => state.closeTab);
  const newTab = useStore((state) => state.newTab);
  const newScriptTab = useStore((state) => state.newScriptTab);
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="tabstrip">
      {tabs.map((tab) => {
        const isScript = tab.kind === 'script';
        const running = tab.job?.status === 'running';
        return (
          <div
            key={tab.id}
            className={`tab${tab.id === activeTabId ? ' active' : ''}`}
            onClick={() => setActiveTab(tab.id)}
          >
            <span
              className="tab-method"
              style={{
                color: isScript ? 'var(--accent)' : (METHOD_COLORS[tab.request.method] ?? 'var(--text-dim)'),
              }}
            >
              {isScript ? 'JS' : tab.request.method}
            </span>
            <span className="tab-name">
              {(isScript ? tab.script.name : tab.request.name) || 'Untitled'}
            </span>
            {running && <span className="dot-running" title="Job running" />}
            {tab.dirty && <span className="dot-dirty" title="Unsaved changes" />}
            <button
              type="button"
              className="tab-close"
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
            >
              ×
            </button>
          </div>
        );
      })}

      <div className="tab-add-wrap">
        <button
          type="button"
          className="tab-add"
          onClick={() => setMenuOpen((open) => !open)}
          title="New tab"
        >
          +
        </button>
        {menuOpen && (
          <>
            <div className="menu-backdrop" onClick={() => setMenuOpen(false)} />
            <div className="tab-menu">
              <button
                type="button"
                onClick={() => {
                  newTab();
                  setMenuOpen(false);
                }}
              >
                <strong>New request</strong>
                <span>Build and send a single call</span>
              </button>
              <button
                type="button"
                onClick={() => {
                  newScriptTab();
                  setMenuOpen(false);
                }}
              >
                <strong>New script</strong>
                <span>Run JavaScript on a loop, in parallel</span>
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function UrlBar({ request, onSave }) {
  const patchRequest = useStore((state) => state.patchRequest);
  const send = useStore((state) => state.send);
  const loading = useStore((state) => state.loading);

  // Typing a query string into the URL fills the Params table, and vice versa.
  const onUrlChange = (value) => {
    const parsed = paramsFromUrl(value);
    patchRequest(parsed ? { url: urlWithoutQuery(value), params: parsed } : { url: value });
  };

  const displayUrl = buildUrlWithParams(request.url, request.params);

  return (
    <div className="urlbar">
      <select
        className="method-select"
        value={request.method}
        onChange={(e) => patchRequest({ method: e.target.value })}
        style={{ color: METHOD_COLORS[request.method] }}
      >
        {METHODS.map((method) => (
          <option key={method} value={method} style={{ color: METHOD_COLORS[method] }}>
            {method}
          </option>
        ))}
      </select>

      <input
        className="url-input"
        type="text"
        value={displayUrl}
        placeholder="https://api.example.com/{{version}}/users"
        onChange={(e) => onUrlChange(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') send();
        }}
      />

      <button type="button" className="btn primary" onClick={send} disabled={loading}>
        {loading ? 'Sending…' : 'Send'}
      </button>
      <button type="button" className="btn" onClick={onSave}>
        Save
      </button>
    </div>
  );
}

function SaveDialog({ onClose }) {
  const collections = useStore((state) => state.collections);
  const saveToCollection = useStore((state) => state.saveToCollection);
  const activeTab = useStore((state) => state.activeTab());
  const patchRequest = useStore((state) => state.patchRequest);
  const [name, setName] = useState(activeTab?.request.name ?? '');

  const save = async (collectionId) => {
    patchRequest({ name });
    // patchRequest is synchronous in the store, so the tab already has the name.
    await saveToCollection(collectionId);
    onClose();
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()} style={{ width: 'min(460px, 92vw)' }}>
        <div className="modal-head">
          <span>Save request</span>
          <button type="button" className="btn ghost small" onClick={onClose}>
            ×
          </button>
        </div>
        <div className="modal-body">
          <label style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
            Request name
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
          </label>
          <p className="hint">Save to collection</p>
          {!collections.length && (
            <p className="empty-hint">Create a collection in the sidebar first.</p>
          )}
          <div className="snippet-list">
            {collections.map((collection) => (
              <button key={collection.id} type="button" onClick={() => save(collection.id)}>
                {collection.name}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

export default function App() {
  const tabs = useStore((state) => state.tabs);
  const activeTabId = useStore((state) => state.activeTabId);
  const loading = useStore((state) => state.loading);
  const toast = useStore((state) => state.toast);
  const environments = useStore((state) => state.environments);
  const activeEnvironmentId = useStore((state) => state.activeEnvironmentId);
  const setActiveEnvironment = useStore((state) => state.setActiveEnvironment);
  const refresh = useStore((state) => state.refresh);
  const runCollection = useStore((state) => state.runCollection);
  const send = useStore((state) => state.send);

  const [showEnv, setShowEnv] = useState(false);
  const [showSave, setShowSave] = useState(false);
  const [showRunner, setShowRunner] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showCookies, setShowCookies] = useState(false);
  const [proxyCount, setProxyCount] = useState(0);

  useEffect(() => {
    if (showSettings) return; // re-check once the modal closes
    api
      .getSettings()
      .then((settings) => {
        const pool = settings.proxy?.enabled
          ? (settings.proxy.list ?? []).filter((entry) => entry.enabled !== false && entry.host)
          : [];
        setProxyCount(pool.length);
      })
      .catch(() => setProxyCount(0));
  }, [showSettings]);

  const tab = tabs.find((item) => item.id === activeTabId) ?? tabs[0];

  useEffect(() => {
    refresh().catch((err) => useStore.getState().notify(err.message, 'error'));
  }, [refresh]);

  useEffect(() => {
    const onKey = (event) => {
      if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
        event.preventDefault();
        const current = useStore.getState().activeTab();
        if (current?.kind === 'script') useStore.getState().runJob();
        else send();
      }
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault();
        setShowSave(true);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [send]);

  const onRunCollection = (collectionId) => {
    setShowRunner(true);
    runCollection(collectionId);
  };

  return (
    <div className="app">
      <header className="topbar">
        <div className="logo">
          <span className="logo-mark">P</span>
          Postguy <small>API client with JS superpowers</small>
        </div>
        <div className="topbar-spacer" />
        <select
          className="env-select"
          value={activeEnvironmentId ?? ''}
          onChange={(e) => setActiveEnvironment(e.target.value || null)}
          title="Active environment"
        >
          <option value="">No environment</option>
          {environments.map((env) => (
            <option key={env.id} value={env.id}>
              {env.name}
            </option>
          ))}
        </select>
        <button type="button" className="btn small" onClick={() => setShowEnv(true)}>
          Manage
        </button>
        <button type="button" className="btn small" onClick={() => setShowCookies(true)}>
          Cookies
        </button>
        <button type="button" className="btn small" onClick={() => setShowSettings(true)}>
          Settings
          {proxyCount > 0 && (
            <span
              className="badge on"
              title={`Requests are rotating across ${proxyCount} prox${proxyCount === 1 ? 'y' : 'ies'}`}
            >
              {proxyCount} proxy
            </span>
          )}
        </button>
      </header>

      <div className="body">
        <Sidebar onRun={onRunCollection} />

        <main className="main">
          <TabStrip />
          {tab &&
            (tab.kind === 'script' ? (
              <ScriptTab tab={tab} key={tab.id} />
            ) : (
              <>
                <UrlBar request={tab.request} onSave={() => setShowSave(true)} />
                <div className="panes">
                  <RequestPanel request={tab.request} key={tab.id} />
                  <ResponsePanel result={tab.response} loading={loading} />
                </div>
              </>
            ))}
        </main>
      </div>

      {showEnv && <EnvironmentModal onClose={() => setShowEnv(false)} />}
      {showSettings && <SettingsModal onClose={() => setShowSettings(false)} />}
      {showCookies && <CookiesModal onClose={() => setShowCookies(false)} />}
      {showSave && <SaveDialog onClose={() => setShowSave(false)} />}
      {showRunner && <RunnerModal onClose={() => setShowRunner(false)} />}

      {toast && <div className={`toast ${toast.tone}`}>{toast.message}</div>}
    </div>
  );
}
