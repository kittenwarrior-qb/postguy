import { useMemo, useState } from 'react';

import { CodeEditor } from './CodeEditor.jsx';
import { Button } from './ui/Button.jsx';
import { Modal } from './ui/Modal.jsx';
import { CODE_TARGETS, codeWarnings, generateCode } from '../lib/codegen.js';
import { useStore } from '../store/useStore.js';

export function CodeModal({ request, onClose }) {
  const notify = useStore((state) => state.notify);
  const [target, setTarget] = useState(() => localStorage.getItem('postguy:codeTarget') || 'curl');

  const chosen = CODE_TARGETS.find((item) => item.id === target) ?? CODE_TARGETS[0];
  const code = useMemo(() => generateCode(request, chosen.id), [request, chosen.id]);
  const warnings = useMemo(() => codeWarnings(request), [request]);

  const pick = (id) => {
    setTarget(id);
    localStorage.setItem('postguy:codeTarget', id);
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      notify('Snippet copied');
    } catch {
      notify('Could not reach the clipboard', 'error');
    }
  };

  return (
    <Modal
      title="Code"
      onClose={onClose}
      width="min(760px, 94vw)"
      footer={
        <>
          <Button onClick={onClose}>Close</Button>
          <Button variant="primary" onClick={copy}>
            Copy
          </Button>
        </>
      }
    >
      <div className="code-targets">
        {CODE_TARGETS.map((item) => (
          <button
            key={item.id}
            type="button"
            className={item.id === chosen.id ? 'active' : ''}
            onClick={() => pick(item.id)}
          >
            {item.label}
          </button>
        ))}
      </div>

      <p className="hint">
        <code>{'{{variables}}'}</code> are left as they are — the snippet mirrors the request in
        front of you.
      </p>

      <div className="code-output">
        <CodeEditor key={chosen.id} value={code} readOnly language={chosen.language} onChange={() => {}} />
      </div>

      {warnings.length > 0 && (
        <ul className="import-warnings">
          {warnings.map((warning, index) => (
            <li key={index}>{warning}</li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
