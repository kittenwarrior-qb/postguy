import { useState } from 'react';

import { CodeEditor } from './CodeEditor.jsx';
import { formatBytes, prettyJson, statusColor } from '../lib/request.js';

function looksLikeJson(text) {
  const trimmed = (text ?? '').trim();
  return trimmed.startsWith('{') || trimmed.startsWith('[');
}

function BodyView({ response }) {
  const [pretty, setPretty] = useState(true);
  const body = response.body ?? '';
  const isJson = looksLikeJson(body);
  const shown = pretty && isJson ? prettyJson(body) : body;

  return (
    <div className="section">
      <div className="body-toolbar">
        <div className="radio-group">
          <label>
            <input type="radio" checked={pretty} onChange={() => setPretty(true)} />
            Pretty
          </label>
          <label>
            <input type="radio" checked={!pretty} onChange={() => setPretty(false)} />
            Raw
          </label>
        </div>
        <button
          type="button"
          className="btn small ghost"
          onClick={() => navigator.clipboard?.writeText(shown)}
          style={{ marginLeft: 'auto' }}
        >
          Copy
        </button>
        {response.truncated && <span className="hint">Body truncated for display</span>}
      </div>
      <div className="pane-body">
        {body ? (
          <CodeEditor value={shown} readOnly language={isJson ? 'json' : 'text'} onChange={() => {}} />
        ) : (
          <p className="empty-hint">Empty response body.</p>
        )}
      </div>
    </div>
  );
}

function HeadersView({ headers }) {
  const entries = Object.entries(headers ?? {});
  if (!entries.length) return <p className="empty-hint">No response headers.</p>;
  return (
    <table className="headers-table">
      <tbody>
        {entries.map(([key, value]) => (
          <tr key={key}>
            <td>{key}</td>
            <td>{value}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function TestsView({ tests }) {
  if (!tests?.length) {
    return (
      <p className="empty-hint">
        No tests ran. Add assertions in the <strong>Scripts → Post-response</strong> tab, e.g.
        <br />
        <code>{`pg.test('status is 200', () => pg.expect(pg.response).to.have.status(200));`}</code>
      </p>
    );
  }
  return (
    <div>
      {tests.map((test, index) => (
        <div className="test-row" key={`${test.name}-${index}`}>
          <span className={`pill ${test.passed ? 'pass' : 'fail'}`}>{test.passed ? 'PASS' : 'FAIL'}</span>
          <span style={{ flex: 1 }}>{test.name}</span>
          {test.error && <span className="test-error">{test.error}</span>}
          <span className="hint">{test.duration}ms</span>
        </div>
      ))}
    </div>
  );
}

function ConsoleView({ logs, scriptErrors }) {
  const hasErrors = scriptErrors?.pre || scriptErrors?.post;
  if (!logs?.length && !hasErrors) {
    return (
      <p className="empty-hint">
        Nothing logged. Use <code>console.log()</code> inside a script and the output shows up here.
      </p>
    );
  }
  return (
    <div>
      {scriptErrors?.pre && (
        <div className="log-row error">
          <span className="log-phase">pre</span>
          <span>Script error: {scriptErrors.pre}</span>
        </div>
      )}
      {scriptErrors?.post && (
        <div className="log-row error">
          <span className="log-phase">post</span>
          <span>Script error: {scriptErrors.post}</span>
        </div>
      )}
      {logs.map((log, index) => (
        <div className={`log-row ${log.level}`} key={index}>
          <span className="log-phase">{log.phase}</span>
          <span>{log.message}</span>
        </div>
      ))}
    </div>
  );
}

export function ResponsePanel({ result, loading }) {
  const [tab, setTab] = useState('body');

  if (loading) {
    return (
      <div className="pane response-pane">
        <div className="response-empty">Sending request…</div>
      </div>
    );
  }

  if (!result) {
    return (
      <div className="pane response-pane">
        <div className="response-empty">
          <strong>Ready when you are</strong>
          <span>Send a request to see the response, tests and console output here.</span>
        </div>
      </div>
    );
  }

  if (result.skipped) {
    return (
      <div className="pane response-pane">
        <div className="tabrow">
          <button type="button" className="active">
            Console
          </button>
        </div>
        <div className="pane-body">
          <p className="empty-hint">
            The pre-request script called <code>pg.execution.skipRequest()</code>, so no HTTP call was
            made.
          </p>
          <ConsoleView logs={result.logs} scriptErrors={result.scriptErrors} />
        </div>
      </div>
    );
  }

  const { response, tests = [], logs = [] } = result;
  const failed = tests.filter((test) => !test.passed).length;

  if (response?.error) {
    return (
      <div className="pane response-pane">
        <div className="tabrow">
          <button type="button" className={tab === 'body' ? 'active' : ''} onClick={() => setTab('body')}>
            Error
          </button>
          <button
            type="button"
            className={tab === 'console' ? 'active' : ''}
            onClick={() => setTab('console')}
          >
            Console
            {logs.length > 0 && <span className="badge">{logs.length}</span>}
          </button>
        </div>
        <div className="pane-body">
          {tab === 'body' ? (
            <div className="response-empty">
              <strong style={{ color: 'var(--red)' }}>Could not send request</strong>
              <span>{response.error}</span>
              {response.failedProxies?.length > 1 && (
                <span className="hint">
                  Tried {response.failedProxies.length} proxies in the pool, none connected.
                </span>
              )}
            </div>
          ) : (
            <ConsoleView logs={logs} scriptErrors={result.scriptErrors} />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="pane response-pane">
      <div className="tabrow">
        <button type="button" className={tab === 'body' ? 'active' : ''} onClick={() => setTab('body')}>
          Body
        </button>
        <button
          type="button"
          className={tab === 'headers' ? 'active' : ''}
          onClick={() => setTab('headers')}
        >
          Headers
          <span className="badge">{Object.keys(response.headers ?? {}).length}</span>
        </button>
        <button type="button" className={tab === 'tests' ? 'active' : ''} onClick={() => setTab('tests')}>
          Tests
          {tests.length > 0 && (
            <span className={`badge ${failed ? 'fail' : 'pass'}`}>
              {tests.length - failed}/{tests.length}
            </span>
          )}
        </button>
        <button
          type="button"
          className={tab === 'console' ? 'active' : ''}
          onClick={() => setTab('console')}
        >
          Console
          {logs.length > 0 && <span className="badge">{logs.length}</span>}
        </button>

        <div className="response-meta">
          <span>
            Status:{' '}
            <strong style={{ color: statusColor(response.status) }}>
              {response.status} {response.statusText}
            </strong>
          </span>
          <span>
            Time: <strong>{response.time} ms</strong>
          </span>
          <span>
            Size: <strong>{formatBytes(response.size)}</strong>
          </span>
          {response.redirects > 0 && (
            <span title="Redirects followed, carrying cookies along the way">
              Redirects: <strong>{response.redirects}</strong>
            </span>
          )}
          {response.via && (
            <span
              className="badge on"
              title={
                response.failedProxies?.length
                  ? `Went out through ${response.via}. Tried first and failed:\n` +
                    response.failedProxies.map((item) => `• ${item.error}`).join('\n')
                  : `This request went out through ${response.via}`
              }
            >
              via {response.via}
              {response.failedProxies?.length > 0 && ` (+${response.failedProxies.length} failed)`}
            </span>
          )}
          {response.setCookies?.length > 0 && (
            <span title={response.setCookies.map((c) => `${c.name}=${c.value}`).join('\n')}>
              Cookies set: <strong>{response.setCookies.length}</strong>
            </span>
          )}
        </div>
      </div>

      <div className="pane-body">
        {tab === 'body' && <BodyView response={response} />}
        {tab === 'headers' && <HeadersView headers={response.headers} />}
        {tab === 'tests' && <TestsView tests={tests} />}
        {tab === 'console' && <ConsoleView logs={logs} scriptErrors={result.scriptErrors} />}
      </div>
    </div>
  );
}
