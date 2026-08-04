import { useState } from 'react';

import { CodeEditor } from './CodeEditor.jsx';
import { BinaryPicker, FormDataEditor } from './FormDataEditor.jsx';
import { KeyValueEditor } from './KeyValueEditor.jsx';
import { ScriptSnippets } from './ScriptSnippets.jsx';
import { api } from '../lib/api.js';
import { activeCount, needsReattach } from '../lib/request.js';
import { useStore } from '../store/useStore.js';

const BODY_MODES = [
  { id: 'none', label: 'none' },
  { id: 'raw', label: 'raw' },
  { id: 'urlencoded', label: 'x-www-form-urlencoded' },
  { id: 'formdata', label: 'form-data' },
  { id: 'binary', label: 'binary' },
];

function OAuth2Editor({ auth, set }) {
  const notify = useStore((state) => state.notify);
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState(null);
  const grantType = auth.grantType ?? 'client_credentials';

  const getToken = async () => {
    setFetching(true);
    setResult(null);
    try {
      const token = await api.getOAuthToken({ ...auth, grantType });
      set({
        accessToken: token.accessToken,
        tokenType: token.tokenType,
        obtainedAt: Date.now(),
        expiresIn: token.expiresIn,
      });
      setResult({ ok: true, expiresIn: token.expiresIn });
      notify('Access token received');
    } catch (err) {
      setResult({ ok: false, error: err.message });
    } finally {
      setFetching(false);
    }
  };

  return (
    <>
      <label>
        Grant type
        <select value={grantType} onChange={(e) => set({ grantType: e.target.value })}>
          <option value="client_credentials">Client credentials</option>
          <option value="password">Password credentials</option>
        </select>
      </label>
      <label>
        Access token URL
        <input
          type="text"
          placeholder="https://auth.example.com/oauth/token"
          value={auth.tokenUrl ?? ''}
          onChange={(e) => set({ tokenUrl: e.target.value })}
        />
      </label>
      <label>
        Client ID
        <input
          type="text"
          value={auth.clientId ?? ''}
          onChange={(e) => set({ clientId: e.target.value })}
        />
      </label>
      <label>
        Client secret
        <input
          type="password"
          value={auth.clientSecret ?? ''}
          onChange={(e) => set({ clientSecret: e.target.value })}
        />
      </label>

      {grantType === 'password' && (
        <>
          <label>
            Username
            <input
              type="text"
              value={auth.username ?? ''}
              onChange={(e) => set({ username: e.target.value })}
            />
          </label>
          <label>
            Password
            <input
              type="password"
              value={auth.password ?? ''}
              onChange={(e) => set({ password: e.target.value })}
            />
          </label>
        </>
      )}

      <label>
        Scope
        <input
          type="text"
          placeholder="read write"
          value={auth.scope ?? ''}
          onChange={(e) => set({ scope: e.target.value })}
        />
      </label>
      <label>
        Send client credentials
        <select value={auth.clientAuth ?? 'body'} onChange={(e) => set({ clientAuth: e.target.value })}>
          <option value="body">In the request body</option>
          <option value="header">As a Basic auth header</option>
        </select>
      </label>

      <label>
        Access token
        <input
          type="text"
          placeholder="Fetched by the button below, or paste one in"
          value={auth.accessToken ?? ''}
          onChange={(e) => set({ accessToken: e.target.value })}
        />
      </label>

      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <button type="button" className="btn small" onClick={getToken} disabled={fetching}>
          {fetching ? 'Requesting…' : 'Get new access token'}
        </button>
        {result && (
          <span className="hint" style={{ color: result.ok ? 'var(--green)' : 'var(--red)' }}>
            {result.ok
              ? `Token stored${result.expiresIn ? ` — expires in ${result.expiresIn}s` : ''}`
              : result.error}
          </span>
        )}
      </div>
      <p className="hint">
        The token request goes through the configured proxy too. All fields support{' '}
        <code>{'{{variables}}'}</code>.
      </p>
    </>
  );
}

function AuthEditor({ auth, onChange }) {
  const type = auth?.type ?? 'none';
  const set = (patch) => onChange({ ...auth, ...patch });

  return (
    <div className="auth-form">
      <label>
        Auth type
        <select value={type} onChange={(e) => set({ type: e.target.value })}>
          <option value="none">No auth</option>
          <option value="bearer">Bearer token</option>
          <option value="basic">Basic auth</option>
          <option value="apiKey">API key</option>
          <option value="oauth2">OAuth 2.0</option>
        </select>
      </label>

      {type === 'oauth2' && <OAuth2Editor auth={auth} set={set} />}

      {type === 'bearer' && (
        <label>
          Token
          <input
            type="text"
            value={auth.token ?? ''}
            placeholder="{{token}}"
            onChange={(e) => set({ token: e.target.value })}
          />
        </label>
      )}

      {type === 'basic' && (
        <>
          <label>
            Username
            <input
              type="text"
              value={auth.username ?? ''}
              onChange={(e) => set({ username: e.target.value })}
            />
          </label>
          <label>
            Password
            <input
              type="text"
              value={auth.password ?? ''}
              onChange={(e) => set({ password: e.target.value })}
            />
          </label>
        </>
      )}

      {type === 'apiKey' && (
        <>
          <label>
            Key
            <input type="text" value={auth.key ?? ''} onChange={(e) => set({ key: e.target.value })} />
          </label>
          <label>
            Value
            <input
              type="text"
              value={auth.value ?? ''}
              onChange={(e) => set({ value: e.target.value })}
            />
          </label>
          <label>
            Add to
            <select value={auth.in ?? 'header'} onChange={(e) => set({ in: e.target.value })}>
              <option value="header">Header</option>
              <option value="query">Query params</option>
            </select>
          </label>
        </>
      )}

      {type === 'none' && (
        <p className="hint">
          This request does not use authorization. Values here support <code>{'{{variables}}'}</code>.
        </p>
      )}
    </div>
  );
}

function BodyEditor({ body, onChange }) {
  const mode = body?.mode ?? 'none';
  const set = (patch) => onChange({ ...body, ...patch });

  return (
    <div className="section">
      <div className="body-toolbar">
        <div className="radio-group">
          {BODY_MODES.map((option) => (
            <label key={option.id}>
              <input
                type="radio"
                name="body-mode"
                checked={mode === option.id}
                onChange={() => set({ mode: option.id })}
              />
              {option.label}
            </label>
          ))}
        </div>
        {mode === 'raw' && (
          <select
            value={body.language ?? 'json'}
            onChange={(e) => set({ language: e.target.value })}
            style={{ marginLeft: 'auto' }}
          >
            <option value="json">JSON</option>
            <option value="text">Text</option>
            <option value="xml">XML</option>
            <option value="html">HTML</option>
          </select>
        )}
      </div>

      {needsReattach(body) && (
        <p className="hint reattach-warning">
          The attached file's bytes were not kept across the reload — pick the file again before
          sending.
        </p>
      )}

      <div className="pane-body">
        {mode === 'none' && <p className="empty-hint">This request does not have a body.</p>}
        {mode === 'raw' && (
          <CodeEditor
            value={body.raw}
            onChange={(value) => set({ raw: value })}
            language={body.language === 'json' ? 'json' : 'text'}
            placeholder="Request body — {{variables}} are resolved before sending"
          />
        )}
        {mode === 'urlencoded' && (
          <KeyValueEditor rows={body.urlencoded} onChange={(rows) => set({ urlencoded: rows })} />
        )}
        {mode === 'formdata' && (
          <FormDataEditor rows={body.formdata} onChange={(rows) => set({ formdata: rows })} />
        )}
        {mode === 'binary' && (
          <BinaryPicker file={body.file} onChange={(file) => set({ file })} />
        )}
      </div>
    </div>
  );
}

function ScriptsEditor({ scripts, onChange }) {
  const [phase, setPhase] = useState('pre');
  const key = phase === 'pre' ? 'preRequest' : 'postResponse';
  const code = scripts?.[key] ?? '';

  const insert = (snippet) => {
    const next = code.trim() ? `${code.trimEnd()}\n\n${snippet}\n` : `${snippet}\n`;
    onChange({ ...scripts, [key]: next });
  };

  return (
    <div className="section">
      <div className="script-toolbar">
        <div className="radio-group">
          <label>
            <input
              type="radio"
              name="script-phase"
              checked={phase === 'pre'}
              onChange={() => setPhase('pre')}
            />
            Pre-request
          </label>
          <label>
            <input
              type="radio"
              name="script-phase"
              checked={phase === 'post'}
              onChange={() => setPhase('post')}
            />
            Post-response
          </label>
        </div>
        <span className="hint">
          Full JavaScript, top-level <code>await</code> allowed. <code>pg</code> (alias{' '}
          <code>pm</code>) is the API.
        </span>
      </div>

      <div className="pane-body" style={{ display: 'flex', minHeight: 0 }}>
        <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid var(--border-soft)' }}>
          <CodeEditor
            // Remount per phase: the editor keeps its old document when the
            // incoming value is an empty string, which would otherwise merge
            // the pre-request and post-response scripts together.
            key={key}
            value={code}
            onChange={(value) => onChange({ ...scripts, [key]: value })}
            language="javascript"
            placeholder={
              phase === 'pre'
                ? "// Runs before the request is sent.\npg.env.set('requestId', pg.utils.uuid());"
                : "// Runs after the response arrives.\npg.test('status is 200', () => pg.expect(pg.response).to.have.status(200));"
            }
          />
        </div>
        <div style={{ width: 280, flexShrink: 0, padding: 12, overflowY: 'auto' }}>
          <p className="hint" style={{ marginTop: 0 }}>
            Snippets
          </p>
          <ScriptSnippets phase={phase} onInsert={insert} />
        </div>
      </div>
    </div>
  );
}

export function RequestPanel({ request }) {
  const [tab, setTab] = useState('params');
  const patchRequest = useStore((state) => state.patchRequest);

  const scriptCount =
    (request.scripts?.preRequest?.trim() ? 1 : 0) + (request.scripts?.postResponse?.trim() ? 1 : 0);

  const tabs = [
    { id: 'params', label: 'Params', count: activeCount(request.params) },
    { id: 'auth', label: 'Authorization', on: (request.auth?.type ?? 'none') !== 'none' },
    { id: 'headers', label: 'Headers', count: activeCount(request.headers) },
    { id: 'body', label: 'Body', on: (request.body?.mode ?? 'none') !== 'none' },
    { id: 'scripts', label: 'Scripts', count: scriptCount, accent: true },
  ];

  return (
    <div className="pane request-pane">
      <div className="tabrow">
        {tabs.map((item) => (
          <button
            key={item.id}
            type="button"
            className={tab === item.id ? 'active' : ''}
            onClick={() => setTab(item.id)}
          >
            {item.label}
            {item.count > 0 && (
              <span className={`badge${item.accent ? ' on' : ''}`}>{item.count}</span>
            )}
            {item.on && <span className="badge on">●</span>}
          </button>
        ))}
      </div>

      <div className="pane-body">
        {tab === 'params' && (
          <KeyValueEditor
            rows={request.params}
            onChange={(rows) => patchRequest({ params: rows })}
            keyPlaceholder="Query param"
          />
        )}
        {tab === 'headers' && (
          <KeyValueEditor
            rows={request.headers}
            onChange={(rows) => patchRequest({ headers: rows })}
            keyPlaceholder="Header"
          />
        )}
        {tab === 'auth' && (
          <AuthEditor auth={request.auth ?? { type: 'none' }} onChange={(auth) => patchRequest({ auth })} />
        )}
        {tab === 'body' && (
          <BodyEditor body={request.body} onChange={(body) => patchRequest({ body })} />
        )}
        {tab === 'scripts' && (
          <ScriptsEditor
            scripts={request.scripts ?? {}}
            onChange={(scripts) => patchRequest({ scripts })}
          />
        )}
      </div>
    </div>
  );
}
