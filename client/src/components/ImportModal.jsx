import { useRef, useState } from 'react';

import { Button } from './ui/Button.jsx';
import { Modal } from './ui/Modal.jsx';
import { api } from '../lib/api.js';
import { METHOD_COLORS } from '../lib/request.js';
import { useStore } from '../store/useStore.js';

const FORMAT_LABELS = {
  curl: 'cURL command',
  'postman/json': 'Postman collection',
  'postman/yaml': 'Postman collection (YAML)',
  'postman-env/json': 'Postman environment',
  'postman-env/yaml': 'Postman environment (YAML)',
  'openapi/json': 'OpenAPI / Swagger (JSON)',
  'openapi/yaml': 'OpenAPI / Swagger (YAML)',
};

const PLACEHOLDER = `Paste one of:

  curl 'https://api.example.com/users' -H 'Authorization: Bearer abc'

  { "info": { "name": "My collection" }, "item": [ … ] }      Postman v2.1

  openapi: 3.0.0                                             OpenAPI, JSON or YAML
  paths: { /users: { get: { summary: List users } } }`;

function Preview({ result }) {
  if (result.kind === 'request') {
    const { request } = result;
    return (
      <div className="import-preview">
        <div className="import-preview-head">
          <span className="method-tag" style={{ color: METHOD_COLORS[request.method] }}>
            {request.method}
          </span>
          <code>{request.url}</code>
        </div>
        <p className="hint">
          {request.headers.length} header{request.headers.length === 1 ? '' : 's'} ·{' '}
          {request.params.length} param{request.params.length === 1 ? '' : 's'} · body:{' '}
          {request.body.mode}
          {request.auth?.type !== 'none' && ` · auth: ${request.auth.type}`}
        </p>
      </div>
    );
  }

  if (result.kind === 'environment') {
    const entries = Object.entries(result.environment.values);
    return (
      <div className="import-preview">
        <div className="import-preview-head">
          <strong>{result.environment.name}</strong>
          <span className="hint">{entries.length} variables</span>
        </div>
        <ul className="import-list">
          {entries.slice(0, 12).map(([key, value]) => (
            <li key={key}>
              <code>{key}</code>
              <span className="hint">{value || '(empty)'}</span>
            </li>
          ))}
        </ul>
      </div>
    );
  }

  const { collection, environment } = result;
  return (
    <div className="import-preview">
      <div className="import-preview-head">
        <strong>{collection.name}</strong>
        <span className="hint">{collection.requests.length} requests</span>
        {environment && <span className="badge on">+ environment</span>}
      </div>
      <ul className="import-list">
        {collection.requests.slice(0, 40).map((request, index) => (
          <li key={index}>
            <span className="method-tag" style={{ color: METHOD_COLORS[request.method] }}>
              {request.method}
            </span>
            <span className="import-name">{request.name}</span>
            <code className="hint">{request.url}</code>
          </li>
        ))}
      </ul>
      {collection.requests.length > 40 && (
        <p className="hint">…and {collection.requests.length - 40} more</p>
      )}
    </div>
  );
}

export function ImportModal({ onClose }) {
  const notify = useStore((state) => state.notify);
  const applyImport = useStore((state) => state.applyImport);
  const fileRef = useRef(null);

  const [text, setText] = useState('');
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const inspect = async (value) => {
    const input = value ?? text;
    if (!input.trim()) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setResult(await api.importText({ text: input }));
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const pickFile = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const content = await file.text();
    setText(content);
    inspect(content);
  };

  const confirm = async () => {
    setBusy(true);
    try {
      await applyImport(result);
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title="Import"
      onClose={onClose}
      width="min(820px, 94vw)"
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={confirm} disabled={!result || busy}>
            {result?.kind === 'collection' ? 'Import collection' : 'Import'}
          </Button>
        </>
      }
    >
      <p className="hint" style={{ marginTop: 0 }}>
        A cURL command, a Postman collection or environment export, or an OpenAPI / Swagger spec in
        JSON or YAML. The format is detected for you.
      </p>

      <div className="import-actions">
        <Button size="small" onClick={() => fileRef.current?.click()}>
          Choose a file
        </Button>
        <input
          ref={fileRef}
          type="file"
          accept=".json,.yaml,.yml,.txt,.sh"
          onChange={pickFile}
          style={{ display: 'none' }}
        />
        <Button size="small" onClick={() => inspect()} disabled={!text.trim() || busy}>
          {busy ? 'Reading…' : 'Check'}
        </Button>
        {text && (
          <Button
            size="small"
            variant="ghost"
            onClick={() => {
              setText('');
              setResult(null);
              setError(null);
            }}
          >
            Clear
          </Button>
        )}
      </div>

      <textarea
        className="import-textarea"
        rows={9}
        value={text}
        placeholder={PLACEHOLDER}
        onChange={(event) => {
          setText(event.target.value);
          setResult(null);
          setError(null);
        }}
        onBlur={() => !result && !error && inspect()}
      />

      {error && <p className="import-error">{error}</p>}

      {result && (
        <>
          <p className="import-format">
            Read as <strong>{FORMAT_LABELS[result.format] ?? result.format}</strong>
          </p>
          <Preview result={result} />
          {result.warnings.length > 0 && (
            <ul className="import-warnings">
              {result.warnings.slice(0, 8).map((warning, index) => (
                <li key={index}>{warning}</li>
              ))}
              {result.warnings.length > 8 && <li>…and {result.warnings.length - 8} more</li>}
            </ul>
          )}
        </>
      )}
    </Modal>
  );
}
