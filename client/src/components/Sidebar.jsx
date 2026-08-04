import { useMemo, useState } from 'react';

import { api } from '../lib/api.js';
import { METHOD_COLORS, blankRequest, formatBytes, formatDuration } from '../lib/request.js';
import { useStore } from '../store/useStore.js';

function CollectionsTree({ onRun, onImport }) {
  const collections = useStore((state) => state.collections);
  const openTab = useStore((state) => state.openTab);
  const refresh = useStore((state) => state.refresh);
  const notify = useStore((state) => state.notify);
  const [expanded, setExpanded] = useState({});

  const toggle = (id) => setExpanded((prev) => ({ ...prev, [id]: !prev[id] }));

  const addCollection = async () => {
    const name = prompt('Collection name', 'New collection');
    if (!name) return;
    await api.createCollection({ name, requests: [] });
    await refresh();
  };

  const removeCollection = async (event, collection) => {
    event.stopPropagation();
    if (!confirm(`Delete collection "${collection.name}"?`)) return;
    await api.deleteCollection(collection.id);
    await refresh();
    notify(`Deleted ${collection.name}`);
  };

  const removeRequest = async (event, collection, requestId) => {
    event.stopPropagation();
    await api.updateCollection(collection.id, {
      ...collection,
      requests: collection.requests.filter((item) => item.id !== requestId),
    });
    await refresh();
  };

  const addRequest = async (event, collection) => {
    event.stopPropagation();
    const request = blankRequest({ name: 'New request' });
    await api.updateCollection(collection.id, {
      ...collection,
      requests: [...(collection.requests ?? []), request],
    });
    await refresh();
    openTab(request);
  };

  return (
    <>
      <div className="sidebar-actions">
        <button type="button" className="btn small" onClick={addCollection}>
          + Collection
        </button>
        <button type="button" className="btn small" onClick={onImport}>
          Import
        </button>
      </div>
      <div className="sidebar-list">
        {!collections.length && (
          <p className="empty-hint">
            No collections yet. Create one, or <strong>Import</strong> a Postman collection, an
            OpenAPI spec or a cURL command.
          </p>
        )}
        {collections.map((collection) => (
          <div key={collection.id}>
            <div className="tree-item" onClick={() => toggle(collection.id)}>
              <span className="tree-caret">{expanded[collection.id] ? '▼' : '▶'}</span>
              <span className="tree-name">{collection.name}</span>
              <span className="hint">{collection.requests?.length ?? 0}</span>
              <span className="tree-actions">
                <button type="button" title="Run collection" onClick={(e) => { e.stopPropagation(); onRun(collection.id); }}>
                  ▶
                </button>
                <button type="button" title="Add request" onClick={(e) => addRequest(e, collection)}>
                  +
                </button>
                <button type="button" title="Delete collection" onClick={(e) => removeCollection(e, collection)}>
                  ×
                </button>
              </span>
            </div>
            {expanded[collection.id] &&
              (collection.requests ?? []).map((request) => (
                <div
                  key={request.id}
                  className="tree-item request"
                  onClick={() => openTab(request)}
                  title={request.url}
                >
                  <span
                    className="method-tag"
                    style={{
                      color:
                        request.kind === 'script'
                          ? 'var(--accent)'
                          : (METHOD_COLORS[request.method] ?? 'var(--text-dim)'),
                    }}
                  >
                    {request.kind === 'script' ? 'JS' : request.method}
                  </span>
                  <span className="tree-name">{request.name}</span>
                  <span className="tree-actions">
                    <button
                      type="button"
                      title="Remove request"
                      onClick={(e) => removeRequest(e, collection, request.id)}
                    >
                      ×
                    </button>
                  </span>
                </div>
              ))}
          </div>
        ))}
      </div>
    </>
  );
}

function HistoryList() {
  const history = useStore((state) => state.history);
  const openTab = useStore((state) => state.openTab);
  const refresh = useStore((state) => state.refresh);
  const notify = useStore((state) => state.notify);
  const [query, setQuery] = useState('');

  const filteredHistory = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return history;
    return history.filter((entry) =>
      [entry.method, entry.url, entry.name, entry.status].some((value) =>
        String(value ?? '').toLowerCase().includes(needle),
      ),
    );
  }, [history, query]);

  const clear = async () => {
    if (!confirm('Clear all history?')) return;
    await api.clearHistory();
    await refresh();
  };

  const remove = async (event, entry) => {
    event.stopPropagation();
    await api.deleteHistory(entry.id);
    await refresh();
    notify('Removed history entry');
  };

  return (
    <>
      <div className="sidebar-actions">
        <button type="button" className="btn small" onClick={clear} disabled={!history.length}>
          Clear history
        </button>
        <input
          className="history-search"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Filter"
          aria-label="Filter request history"
        />
      </div>
      <div className="sidebar-list">
        {!history.length && <p className="empty-hint">Requests you send show up here.</p>}
        {history.length > 0 && !filteredHistory.length && (
          <p className="empty-hint">No history matches “{query}”.</p>
        )}
        {filteredHistory.map((entry) => (
          <div
            key={entry.id}
            className="tree-item history-item"
            onClick={() => openTab({ ...entry.request, id: `${entry.request.id ?? 'req'}-${entry.id}` })}
            title="Open in Repeater"
          >
            <span
              className="method-tag"
              style={{ color: METHOD_COLORS[entry.method] ?? 'var(--text-dim)' }}
            >
              {entry.method}
            </span>
            <span className="tree-name history-name">
              <span>{entry.name || entry.url}</span>
              <small>{entry.url}</small>
            </span>
            <span className={`history-status ${entry.error ? 'error' : ''}`}>
              {entry.status ?? 'ERR'}
            </span>
            <span className="history-actions">
              <span className="history-time" title={`${formatBytes(entry.size)} response`}>
                {formatDuration(entry.time)}
              </span>
              <button type="button" title="Remove history entry" onClick={(event) => remove(event, entry)}>
                ×
              </button>
            </span>
            {entry.testsFailed > 0 && <span className="badge fail">{entry.testsFailed}</span>}
          </div>
        ))}
      </div>
    </>
  );
}

export function Sidebar({ onRun, onImport }) {
  const sidebarTab = useStore((state) => state.sidebarTab);
  const setTab = (tab) => useStore.setState({ sidebarTab: tab });

  return (
    <aside className="sidebar">
      <div className="sidebar-tabs">
        <button
          type="button"
          className={sidebarTab === 'collections' ? 'active' : ''}
          onClick={() => setTab('collections')}
        >
          Collections
        </button>
        <button
          type="button"
          className={sidebarTab === 'history' ? 'active' : ''}
          onClick={() => setTab('history')}
        >
          History
        </button>
      </div>
      {sidebarTab === 'collections' ? (
        <CollectionsTree onRun={onRun} onImport={onImport} />
      ) : (
        <HistoryList />
      )}
    </aside>
  );
}
