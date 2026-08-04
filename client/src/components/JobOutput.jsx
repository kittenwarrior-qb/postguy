import { useEffect, useMemo, useRef, useState } from 'react';

import { CodeEditor } from './CodeEditor.jsx';
import { KeyValueEditor } from './KeyValueEditor.jsx';
import { METHOD_COLORS, formatBytes, statusColor } from '../lib/request.js';
import { useStore } from '../store/useStore.js';

function looksLikeJson(text) {
  const trimmed = (text ?? '').trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function shortUrl(url) {
  try {
    const parsed = new URL(url);
    return `${parsed.pathname}${parsed.search}` || '/';
  } catch {
    return url;
  }
}

function JsonNode({ label, value, depth = 0 }) {
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === 'object';
  if (!isObject) {
    return (
      <div className="json-leaf">
        {label !== undefined && <span className="json-key">{label}: </span>}
        <code className={`json-value ${value === null ? 'null' : typeof value}`}>
          {JSON.stringify(value)}
        </code>
      </div>
    );
  }

  const entries = Object.entries(value);
  return (
    <details className="json-node" open={depth < 1}>
      <summary>
        {label !== undefined && <span className="json-key">{label}: </span>}
        <span className="json-brace">{isArray ? '[' : '{'}</span>
        <span className="json-count">{entries.length} {isArray ? 'items' : 'keys'}</span>
        <span className="json-brace">{isArray ? ']' : '}'}</span>
      </summary>
      <div className="json-children">
        {entries.map(([key, child]) => (
          <JsonNode key={key} label={isArray ? Number(key) : key} value={child} depth={depth + 1} />
        ))}
      </div>
    </details>
  );
}

function JsonBody({ body }) {
  try {
    return (
      <div className="json-tree">
        <JsonNode value={JSON.parse(body)} />
      </div>
    );
  } catch {
    return null;
  }
}

function RequestDetail({ entry, onClose }) {
  const [tab, setTab] = useState('body');
  const isJson = looksLikeJson(entry.body);

  return (
    <div className="request-detail">
      <div className="request-detail-head">
        <span className="method-tag" style={{ color: METHOD_COLORS[entry.method] }}>
          {entry.method}
        </span>
        <span className="request-detail-url" title={entry.url}>
          {entry.url}
        </span>
        <button
          type="button"
          className={tab === 'body' ? 'active' : ''}
          onClick={() => setTab('body')}
        >
          Body
        </button>
        <button
          type="button"
          className={tab === 'headers' ? 'active' : ''}
          onClick={() => setTab('headers')}
        >
          Headers
        </button>
        <button type="button" className="btn ghost small" onClick={onClose} title="Close">
          ×
        </button>
      </div>

      <div className="request-detail-body">
        {tab === 'body' ? (
          entry.error ? (
            <p className="empty-hint" style={{ color: 'var(--red)' }}>{entry.error}</p>
          ) : entry.body ? (
            isJson ? (
              <JsonBody body={entry.body} />
            ) : (
              <CodeEditor
                key={`${entry.n}-${tab}`}
                value={entry.body}
                readOnly
                language="text"
                onChange={() => {}}
              />
            )
          ) : (
            <p className="empty-hint">Empty response body.</p>
          )
        ) : (
          <table className="headers-table">
            <tbody>
              {Object.entries(entry.headers ?? {}).map(([key, value]) => (
                <tr key={key}>
                  <td>{key}</td>
                  <td>{value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        {entry.bodyTruncated && <p className="hint">Body truncated at 64 KB.</p>}
      </div>
    </div>
  );
}

function RequestsView({ requests }) {
  const [selected, setSelected] = useState(null);
  const entry = requests.find((item) => item.n === selected) ?? null;

  if (!requests.length) {
    return (
      <p className="empty-hint">
        No requests yet. Every <code>pg.sendRequest()</code> the script makes is listed here with its
        full response.
      </p>
    );
  }

  return (
    <div className="response-cards">
      {requests.map((item) => (
        <div className="response-card" key={item.n} data-open={item.n === selected} data-failed={!item.ok}>
          <button
            type="button"
            className="response-card-summary"
            onClick={() => setSelected(item.n === selected ? null : item.n)}
          >
            <span className="response-card-index">#{item.n}</span>
            <span className="method-tag" style={{ color: METHOD_COLORS[item.method] }}>
              {item.method}
            </span>
            <span className="response-card-main">
              <strong>Iteration {item.iteration}</strong>
              <small title={item.url}>{shortUrl(item.url)}</small>
            </span>
            <span className="response-card-status" style={{ color: statusColor(item.status) }}>
              {item.status ?? 'ERR'}
            </span>
            <span className="response-card-meta">{item.time} ms · {formatBytes(item.size)}</span>
            <span className="response-card-proxy">{item.via ?? 'Direct'}</span>
            <span className="response-card-chevron">{item.n === selected ? '⌃' : '⌄'}</span>
          </button>
          {entry?.n === item.n && <RequestDetail entry={entry} onClose={() => setSelected(null)} />}
        </div>
      ))}
    </div>
  );
}

function ResultsView({ rows }) {
  const columns = useMemo(() => {
    const keys = new Set();
    for (const row of rows) {
      for (const key of Object.keys(row)) {
        if (key !== 'at') keys.add(key);
      }
    }
    // `iteration` is added by the runner, so it leads.
    return ['iteration', ...[...keys].filter((key) => key !== 'iteration')];
  }, [rows]);

  if (!rows.length) {
    return (
      <p className="empty-hint">
        No rows recorded. Call <code>pg.record({'{ any: "value" }'})</code> in the script and each
        call becomes a row here, with a column per key.
      </p>
    );
  }

  return (
    <table className="job-table">
      <thead>
        <tr>
          {columns.map((column) => (
            <th key={column}>{column}</th>
          ))}
          <th className="spacer" />
        </tr>
      </thead>
      <tbody>
        {rows.map((row, index) => (
          <tr key={index}>
            {columns.map((column) => (
              <td key={column}>
                {row[column] === undefined || row[column] === null
                  ? '—'
                  : typeof row[column] === 'object'
                    ? JSON.stringify(row[column])
                    : String(row[column])}
              </td>
            ))}
            <td className="spacer" />
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ConsoleView({ logs, running }) {
  const endRef = useRef(null);

  useEffect(() => {
    if (running) endRef.current?.scrollIntoView({ block: 'end' });
  }, [logs.length, running]);

  if (!logs.length) {
    return (
      <p className="empty-hint">
        Nothing logged. <code>console.log()</code> from the script shows up here, tagged with the
        iteration it came from.
      </p>
    );
  }

  return (
    <div>
      {logs.map((log, index) => (
        <div className={`log-row ${log.level}`} key={index}>
          <span className="log-phase">#{log.iteration}</span>
          <span>{log.message}</span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}

export function JobOutput({ tab }) {
  const [view, setView] = useState('requests');
  const patchScript = useStore((state) => state.patchScript);

  const { job, script } = tab;
  const running = job.status === 'running';
  const failed = job.requests.filter((item) => !item.ok).length;

  return (
    <div className="pane job-output-pane">
      <div className="tabrow">
        <button
          type="button"
          className={view === 'requests' ? 'active' : ''}
          onClick={() => setView('requests')}
        >
          Requests
          {job.requests.length > 0 && (
            <span className={`badge${failed ? ' fail' : ''}`}>{job.requests.length}</span>
          )}
        </button>
        <button
          type="button"
          className={view === 'results' ? 'active' : ''}
          onClick={() => setView('results')}
        >
          Results
          {job.rows.length > 0 && <span className="badge">{job.rows.length}</span>}
        </button>
        <button
          type="button"
          className={view === 'console' ? 'active' : ''}
          onClick={() => setView('console')}
        >
          Console
          {job.logs.length > 0 && <span className="badge">{job.logs.length}</span>}
        </button>
        <button
          type="button"
          className={view === 'vars' ? 'active' : ''}
          onClick={() => setView('vars')}
        >
          Variables
        </button>
      </div>

      <div className="pane-body">
        {view === 'requests' && <RequestsView requests={job.requests} />}
        {view === 'results' && <ResultsView rows={job.rows} />}
        {view === 'console' && <ConsoleView logs={job.logs} running={running} />}
        {view === 'vars' && (
          <>
            <p className="hint" style={{ padding: '8px 12px 0' }}>
              Available as <code>pg.vars</code>. Whatever the script writes back is kept here for the
              next run.
            </p>
            <KeyValueEditor
              rows={script.vars}
              onChange={(vars) => patchScript({ vars })}
              keyPlaceholder="Variable"
            />
          </>
        )}
      </div>
    </div>
  );
}
