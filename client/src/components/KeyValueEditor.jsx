import { emptyRow } from '../lib/request.js';

/**
 * The editable key/value grid used for params, headers and form bodies.
 * Like Postman, an empty trailing row is always kept so there is somewhere
 * to type without pressing "Add".
 */
export function KeyValueEditor({ rows, onChange, keyPlaceholder = 'Key', valuePlaceholder = 'Value' }) {
  const list = rows?.length ? rows : [emptyRow()];

  const commit = (next) => {
    const trimmed = [...next];
    const last = trimmed[trimmed.length - 1];
    if (!last || last.key.trim() || last.value.trim()) trimmed.push(emptyRow());
    onChange(trimmed);
  };

  const patch = (index, patchValue) =>
    commit(list.map((row, i) => (i === index ? { ...row, ...patchValue } : row)));

  const remove = (index) => {
    const next = list.filter((_, i) => i !== index);
    onChange(next.length ? next : [emptyRow()]);
  };

  return (
    <table className="kv">
      <thead>
        <tr>
          <th className="check" />
          <th>{keyPlaceholder}</th>
          <th>{valuePlaceholder}</th>
          <th>Description</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {list.map((row, index) => (
          <tr key={row.id ?? index} className={row.enabled === false ? 'disabled' : ''}>
            <td className="check">
              <input
                type="checkbox"
                checked={row.enabled !== false}
                onChange={(e) => patch(index, { enabled: e.target.checked })}
                aria-label="Enable row"
              />
            </td>
            <td>
              <input
                type="text"
                value={row.key}
                placeholder={keyPlaceholder}
                onChange={(e) => patch(index, { key: e.target.value })}
              />
            </td>
            <td>
              <input
                type="text"
                value={row.value}
                placeholder={valuePlaceholder}
                onChange={(e) => patch(index, { value: e.target.value })}
              />
            </td>
            <td>
              <input
                type="text"
                value={row.description ?? ''}
                placeholder="Description"
                onChange={(e) => patch(index, { description: e.target.value })}
              />
            </td>
            <td className="remove">
              {list.length > 1 && (
                <button type="button" onClick={() => remove(index)} title="Remove row">
                  ×
                </button>
              )}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
