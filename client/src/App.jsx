import { useEffect, useState } from 'react';

import { CodeModal } from './components/CodeModal.jsx';
import { CookiesModal } from './components/CookiesModal.jsx';
import { EnvironmentModal } from './components/EnvironmentModal.jsx';
import { ImportModal } from './components/ImportModal.jsx';
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
import { Badge } from './components/ui/Badge.jsx';
import { Button } from './components/ui/Button.jsx';
import { Modal } from './components/ui/Modal.jsx';

const THEME_OPTIONS = [
  { id: 'dark', label: 'Professional Dark', accent: '#8b93ff', solid: '#5b63e8' },
  { id: 'midnight', label: 'Midnight', accent: '#6fb3ff', solid: '#3b7dd8' },
  { id: 'tokyo', label: 'Tokyo Night', accent: '#c3a6f7', solid: '#9568e0' },
  { id: 'postman', label: 'Postman Orange', accent: '#ff6c37', solid: '#e85a2a' },
];

function ThemeSwitch() {
  const [theme, setTheme] = useState(() => localStorage.getItem('postguy:theme') || 'dark');

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('postguy:theme', theme);
  }, [theme]);

  return (
    <div className="theme-switch" aria-label="Color theme">
      {THEME_OPTIONS.map((option) => (
        <button
          key={option.id}
          type="button"
          className={`theme-dot${theme === option.id ? ' active' : ''}`}
          title={option.label}
          aria-label={option.label}
          onClick={() => setTheme(option.id)}
          style={{ '--theme-accent': option.accent, '--theme-solid': option.solid }}
        >
          <span />
        </button>
      ))}
    </div>
  );
}

function TabStrip() {
  const tabs = useStore((state) => state.tabs);
  const activeTabId = useStore((state) => state.activeTabId);
  const setActiveTab = useStore((state) => state.setActiveTab);
  const closeTab = useStore((state) => state.closeTab);
  const newTab = useStore((state) => state.newTab);
  const newScriptTab = useStore((state) => state.newScriptTab);
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPosition, setMenuPosition] = useState(null);

  const toggleMenu = (event) => {
    if (menuOpen) {
      setMenuOpen(false);
      setMenuPosition(null);
      return;
    }
    const rect = event.currentTarget.getBoundingClientRect();
    setMenuPosition({ top: rect.bottom + 4, left: rect.left });
    setMenuOpen(true);
  };

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
          onClick={toggleMenu}
          title="New tab"
        >
          +
        </button>
        {menuOpen && (
          <>
            <div
              className="menu-backdrop"
              onClick={() => {
                setMenuOpen(false);
                setMenuPosition(null);
              }}
            />
            <div className="tab-menu" style={menuPosition ?? undefined}>
              <button
                type="button"
                onClick={() => {
                  newTab();
                  setMenuOpen(false);
                  setMenuPosition(null);
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
                  setMenuPosition(null);
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

function UrlBar({ request, onSave, onCode }) {
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

      <Button variant="primary" onClick={send} disabled={loading}>
        {loading ? 'Sending…' : 'Send'}
      </Button>
      <Button onClick={onSave}>
        Save
      </Button>
      <Button onClick={onCode} title="Generate a code snippet for this request">
        {'</>'}
      </Button>
    </div>
  );
}

function SaveDialog({ onClose }) {
  const collections = useStore((state) => state.collections);
  const saveToCollection = useStore((state) => state.saveToCollection);
  const activeTab = useStore((state) => state.activeTab());
  const patchRequest = useStore((state) => state.patchRequest);
  const patchScript = useStore((state) => state.patchScript);
  const isScript = activeTab?.kind === 'script';
  const [name, setName] = useState(isScript ? activeTab?.script.name ?? '' : activeTab?.request.name ?? '');

  const save = async (collectionId) => {
    if (isScript) patchScript({ name });
    else patchRequest({ name });
    // patchRequest is synchronous in the store, so the tab already has the name.
    await saveToCollection(collectionId);
    onClose();
  };

  return (
    <Modal title={isScript ? 'Save script asset' : 'Save request'} onClose={onClose} width="min(460px, 92vw)">
      <label style={{ display: 'grid', gap: 6, marginBottom: 14 }}>
        {isScript ? 'Asset name' : 'Request name'}
        <input type="text" value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      <p className="hint">Save to collection</p>
      {!collections.length && <p className="empty-hint">Create a collection in the sidebar first.</p>}
      <div className="snippet-list">
        {collections.map((collection) => (
          <button key={collection.id} type="button" onClick={() => save(collection.id)}>
            {collection.name}
          </button>
        ))}
      </div>
    </Modal>
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
  const [showImport, setShowImport] = useState(false);
  const [showCode, setShowCode] = useState(false);
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
          <div className="logo-copy">
            <strong>PostGuy</strong>
            <small>API client with JS superpowers</small>
          </div>
        </div>
        <div className="topbar-spacer" />
        <ThemeSwitch />
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
        <Button className="top-btn" onClick={() => setShowEnv(true)}>
          Manage
        </Button>
        <Button className="top-btn" onClick={() => setShowCookies(true)}>
          Cookies
        </Button>
        <Button className="top-btn" onClick={() => setShowSettings(true)}>
          Settings
          {proxyCount > 0 && (
            <Badge
              tone="on"
              title={`Requests are rotating across ${proxyCount} prox${proxyCount === 1 ? 'y' : 'ies'}`}
            >
              {proxyCount} proxy
            </Badge>
          )}
        </Button>
      </header>

      <div className="body">
        <Sidebar onRun={onRunCollection} onImport={() => setShowImport(true)} />

        <main className="main">
          <TabStrip />
          {tab &&
            (tab.kind === 'script' ? (
                <ScriptTab tab={tab} key={tab.id} onSave={() => setShowSave(true)} />
            ) : (
              <>
                <UrlBar
                  request={tab.request}
                  onSave={() => setShowSave(true)}
                  onCode={() => setShowCode(true)}
                />
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
      {showImport && <ImportModal onClose={() => setShowImport(false)} />}
      {showCode && tab?.kind !== 'script' && (
        <CodeModal request={tab.request} onClose={() => setShowCode(false)} />
      )}

      {toast && <div className={`toast ${toast.tone}`}>{toast.message}</div>}
    </div>
  );
}
