import { useEffect, useState } from 'react';

import { api } from '../lib/api.js';
import { emptyRow } from '../lib/request.js';
import { useStore } from '../store/useStore.js';
import { KeyValueEditor } from './KeyValueEditor.jsx';

function valuesToRows(values) {
  const rows = Object.entries(values ?? {}).map(([key, value]) => ({
    id: `env_${key}`,
    key,
    value: String(value ?? ''),
    enabled: true,
  }));
  return rows.length ? [...rows, emptyRow()] : [emptyRow()];
}

function rowsToValues(rows) {
  const values = {};
  for (const row of rows ?? []) {
    if (row.enabled === false || !row.key.trim()) continue;
    values[row.key.trim()] = row.value ?? '';
  }
  return values;
}

export function EnvironmentModal({ onClose }) {
  const environments = useStore((state) => state.environments);
  const refresh = useStore((state) => state.refresh);
  const notify = useStore((state) => state.notify);
  const activeEnvironmentId = useStore((state) => state.activeEnvironmentId);

  const [selectedId, setSelectedId] = useState(activeEnvironmentId ?? environments[0]?.id ?? null);
  const [rows, setRows] = useState([emptyRow()]);
  const [name, setName] = useState('');

  const selected = environments.find((env) => env.id === selectedId) ?? null;

  useEffect(() => {
    setRows(valuesToRows(selected?.values));
    setName(selected?.name ?? '');
  }, [selectedId, selected?.updatedAt]);

  const create = async () => {
    const created = await api.createEnvironment({ name: 'New environment', values: {} });
    await refresh();
    setSelectedId(created.id);
  };

  const save = async () => {
    if (!selected) return;
    await api.updateEnvironment(selected.id, { ...selected, name, values: rowsToValues(rows) });
    await refresh();
    notify(`Saved ${name}`);
  };

  const remove = async () => {
    if (!selected || !confirm(`Delete environment "${selected.name}"?`)) return;
    await api.deleteEnvironment(selected.id);
    if (activeEnvironmentId === selected.id) useStore.getState().setActiveEnvironment(null);
    await refresh();
    setSelectedId(null);
  };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <span>Environments</span>
          <button type="button" className="btn ghost small" onClick={onClose}>
            ×
          </button>
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
            <select
              value={selectedId ?? ''}
              onChange={(e) => setSelectedId(e.target.value || null)}
              style={{ flex: 1 }}
            >
              <option value="">— select an environment —</option>
              {environments.map((env) => (
                <option key={env.id} value={env.id}>
                  {env.name}
                </option>
              ))}
            </select>
            <button type="button" className="btn small" onClick={create}>
              + New
            </button>
            {selected && (
              <button type="button" className="btn small" onClick={remove}>
                Delete
              </button>
            )}
          </div>

          {selected ? (
            <>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Environment name"
                style={{ width: '100%', marginBottom: 10 }}
              />
              <p className="hint" style={{ marginTop: 0 }}>
                Reference these anywhere as <code>{'{{name}}'}</code>. Scripts can update them at
                runtime with <code>pg.env.set()</code>.
              </p>
              <KeyValueEditor rows={rows} onChange={setRows} keyPlaceholder="Variable" />
            </>
          ) : (
            <p className="empty-hint">Select an environment above, or create a new one.</p>
          )}
        </div>

        <div className="modal-foot">
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
          {selected && (
            <button type="button" className="btn primary" onClick={save}>
              Save
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
