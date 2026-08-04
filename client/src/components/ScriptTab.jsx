import { CodeEditor } from './CodeEditor.jsx';
import { JobOutput } from './JobOutput.jsx';
import { INTERVAL_UNITS, formatDuration, intervalToMs } from '../lib/request.js';
import { useStore } from '../store/useStore.js';
import { SCRIPT_ASSETS } from '../lib/scriptAssets.js';

const STATUS_LABELS = {
  idle: 'Idle',
  running: 'Running',
  done: 'Finished',
  stopped: 'Stopped',
  error: 'Failed',
  disconnected: 'Disconnected',
};

function RunSummary({ job, config }) {
  const stats = job.stats;
  const running = job.status === 'running';
  const total = stats?.iterationsTotal ?? config.iterations;
  const done = stats?.iterationsDone ?? 0;
  const percent = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
  const elapsed = job.startedAt ? (job.finishedAt ?? Date.now()) - job.startedAt : null;

  return (
    <div className="run-summary">
      <span className={`pill status ${job.status}`}>{STATUS_LABELS[job.status] ?? job.status}</span>

      {job.status !== 'idle' && (
        <>
          <div className="progress" title={`${done} of ${total} iterations`}>
            <div className="progress-fill" style={{ width: `${percent}%` }} data-running={running} />
          </div>
          <span className="hint">
            {done}/{total} iterations
          </span>
          {stats && (
            <span className="hint">
              <strong style={{ color: 'var(--green)' }}>{stats.ok}</strong> ok ·{' '}
              <strong style={{ color: stats.failed ? 'var(--red)' : 'var(--text-dim)' }}>
                {stats.failed}
              </strong>{' '}
              failed
            </span>
          )}
          {elapsed !== null && <span className="hint">{formatDuration(elapsed)}</span>}
        </>
      )}

      {job.error && <span className="hint" style={{ color: 'var(--red)' }}>{job.error}</span>}
    </div>
  );
}

export function ScriptTab({ tab, onSave }) {
  const patchScript = useStore((state) => state.patchScript);
  const runJob = useStore((state) => state.runJob);
  const stopJob = useStore((state) => state.stopJob);
  const clearJobOutput = useStore((state) => state.clearJobOutput);

  const { script, job } = tab;
  const config = script.config;
  const running = job.status === 'running';

  const setConfig = (patch) => patchScript({ config: { ...config, ...patch } });

  const loadAsset = (assetId) => {
    const asset = SCRIPT_ASSETS.find((item) => item.id === assetId);
    if (!asset) return;
    const vars = asset.vars.map((row) => ({
      id: `${asset.id}-${row.key}`,
      key: row.key,
      value: row.value,
      description: row.description,
      enabled: true,
    }));
    patchScript({
      name: asset.name,
      code: asset.code,
      vars,
      config: { ...asset.config },
    });
  };

  const totalWait = intervalToMs(config.interval, config.intervalUnit);
  const estimate =
    config.iterations > 1 && totalWait > 0
      ? formatDuration((Math.ceil(config.iterations / config.concurrency) - 1) * totalWait)
      : null;

  return (
    <>
      <div className="urlbar">
        <span className="script-chip">JS</span>
        <input
          className="url-input"
          type="text"
          value={script.name}
          placeholder="Script name"
          onChange={(e) => patchScript({ name: e.target.value })}
        />
        <select
          className="asset-select"
          defaultValue=""
          onChange={(e) => {
            loadAsset(e.target.value);
            e.target.value = '';
          }}
          aria-label="Load script asset"
        >
          <option value="" disabled>Load asset</option>
          {SCRIPT_ASSETS.map((asset) => <option key={asset.id} value={asset.id}>{asset.name}</option>)}
        </select>
        <button type="button" className="btn ghost" onClick={onSave}>Save</button>
        {running ? (
          <button type="button" className="btn danger" onClick={stopJob}>
            Stop
          </button>
        ) : (
          <button type="button" className="btn primary" onClick={runJob}>
            Run
          </button>
        )}
      </div>

      <div className="script-config">
        <label>
          Iterations
          <input
            type="number"
            min="1"
            value={config.iterations}
            disabled={running}
            onChange={(e) => setConfig({ iterations: Math.max(1, Number(e.target.value) || 1) })}
          />
        </label>
        <label>
          Concurrency
          <input
            type="number"
            min="1"
            value={config.concurrency}
            disabled={running}
            onChange={(e) => setConfig({ concurrency: Math.max(1, Number(e.target.value) || 1) })}
          />
        </label>
        <label className="interval-field">
          Interval
          <span>
            <input
              type="number"
              min="0"
              value={config.interval}
              disabled={running}
              onChange={(e) => setConfig({ interval: Math.max(0, Number(e.target.value) || 0) })}
            />
            <select
              value={config.intervalUnit}
              disabled={running}
              onChange={(e) => setConfig({ intervalUnit: e.target.value })}
            >
              {INTERVAL_UNITS.map((unit) => (
                <option key={unit.id} value={unit.id}>
                  {unit.label}
                </option>
              ))}
            </select>
          </span>
        </label>

        <span className="hint script-config-note">
          {config.concurrency > 1
            ? `${config.concurrency} lanes pull from the queue`
            : 'One at a time'}
          {totalWait > 0 && `, pausing ${formatDuration(totalWait)} between iterations`}
          {estimate && ` — at least ${estimate} in total`}
        </span>

        <div className="script-config-actions">
          {job.status !== 'idle' && !running && (
            <button type="button" className="btn ghost small" onClick={clearJobOutput}>
              Clear output
            </button>
          )}
        </div>
      </div>

      <RunSummary job={job} config={config} />

      <div className="panes">
        <div className="pane script-editor-pane">
          <div className="tabrow">
            <button type="button" className="active">
              Script
            </button>
            <span className="hint" style={{ marginLeft: 'auto', paddingRight: 12 }}>
              Runs once per iteration · <code>pg.job.iteration</code> is the current number
            </span>
          </div>
          <div className="pane-body">
            <CodeEditor
              value={script.code}
              onChange={(code) => patchScript({ code })}
              language="javascript"
              placeholder="// Describe one iteration. The toolbar repeats it."
            />
          </div>
        </div>

        <JobOutput tab={tab} />
      </div>
    </>
  );
}
