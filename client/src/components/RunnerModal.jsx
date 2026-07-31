import { METHOD_COLORS, statusColor } from '../lib/request.js';
import { useStore } from '../store/useStore.js';

export function RunnerModal({ onClose }) {
  const result = useStore((state) => state.runnerResult);
  const loading = useStore((state) => state.loading);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Collection runner{result ? ` — ${result.collectionName}` : ''}</span>
          <button type="button" className="btn ghost small" onClick={onClose}>
            ×
          </button>
        </div>

        {loading && <div className="modal-body">Running…</div>}

        {!loading && result && (
          <>
            <div className="runner-summary">
              <span>
                Requests: <strong>{result.summary.requests}</strong>
              </span>
              <span style={{ color: 'var(--green)' }}>
                Passed: <strong>{result.summary.passed}</strong>
              </span>
              <span style={{ color: result.summary.failed ? 'var(--red)' : 'var(--text-dim)' }}>
                Failed: <strong>{result.summary.failed}</strong>
              </span>
              <span>
                Total: <strong>{result.summary.totalTime} ms</strong>
              </span>
            </div>

            <div className="modal-body" style={{ padding: 0 }}>
              {result.results.map((row) => (
                <div className="runner-row" key={row.requestId}>
                  <div className="runner-row-head">
                    <span
                      className="method-tag"
                      style={{ color: METHOD_COLORS[row.method] ?? 'var(--text-dim)' }}
                    >
                      {row.method}
                    </span>
                    <span style={{ flex: 1 }}>{row.name}</span>
                    {row.skipped ? (
                      <span className="hint">skipped by script</span>
                    ) : row.error ? (
                      <span style={{ color: 'var(--red)' }}>{row.error}</span>
                    ) : (
                      <span style={{ color: statusColor(row.status) }}>
                        {row.status} · {row.time} ms
                      </span>
                    )}
                  </div>
                  <div className="runner-row-url">{row.url}</div>
                  {row.tests.map((test, index) => (
                    <div className="test-row" key={index} style={{ padding: '5px 0', border: 0 }}>
                      <span className={`pill ${test.passed ? 'pass' : 'fail'}`}>
                        {test.passed ? 'PASS' : 'FAIL'}
                      </span>
                      <span style={{ flex: 1 }}>{test.name}</span>
                      {test.error && <span className="test-error">{test.error}</span>}
                    </div>
                  ))}
                  {(row.scriptErrors?.pre || row.scriptErrors?.post) && (
                    <div className="test-error" style={{ paddingTop: 4 }}>
                      {row.scriptErrors.pre ?? row.scriptErrors.post}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        {!loading && !result && <div className="modal-body">No run yet.</div>}

        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
