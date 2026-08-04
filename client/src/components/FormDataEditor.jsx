import { useRef } from 'react';

import { emptyRow, formatBytes } from '../lib/request.js';
import { readFile } from '../lib/files.js';
import { useStore } from '../store/useStore.js';

/**
 * The multipart body editor. Same grid as the other key/value tables, plus a
 * per-row Text/File switch — a file row carries the bytes to send.
 */
export function FormDataEditor({ rows, onChange }) {
  const notify = useStore((state) => state.notify);
  const inputs = useRef({});
  const list = rows?.length ? rows : [emptyRow()];

  const commit = (next) => {
    const trimmed = [...next];
    const last = trimmed[trimmed.length - 1];
    if (!last || last.key.trim() || last.value?.trim() || last.fileName) trimmed.push(emptyRow());
    onChange(trimmed);
  };

  const patch = (index, patchValue) =>
    commit(list.map((row, i) => (i === index ? { ...row, ...patchValue } : row)));

  const remove = (index) => {
    const next = list.filter((_, i) => i !== index);
    onChange(next.length ? next : [emptyRow()]);
  };

  const attach = async (index, event) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // let the same file be picked again
    if (!file) return;
    try {
      const attached = await readFile(file);
      patch(index, { type: 'file', ...attached, value: '' });
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  return (
    <table className="kv formdata">
      <thead>
        <tr>
          <th className="check" />
          <th>Key</th>
          <th className="type">Type</th>
          <th>Value</th>
          <th />
        </tr>
      </thead>
      <tbody>
        {list.map((row, index) => {
          const isFile = row.type === 'file';
          const lostBytes = isFile && row.fileName && !row.data;

          return (
            <tr key={row.id ?? index} className={row.enabled === false ? 'disabled' : ''}>
              <td className="check">
                <input
                  type="checkbox"
                  checked={row.enabled !== false}
                  onChange={(event) => patch(index, { enabled: event.target.checked })}
                  aria-label="Enable row"
                />
              </td>
              <td>
                <input
                  type="text"
                  value={row.key}
                  placeholder="Key"
                  onChange={(event) => patch(index, { key: event.target.value })}
                />
              </td>
              <td className="type">
                <select
                  value={isFile ? 'file' : 'text'}
                  onChange={(event) =>
                    patch(index, {
                      type: event.target.value === 'file' ? 'file' : 'text',
                      // Switching away from a file drops its bytes with it.
                      ...(event.target.value === 'file'
                        ? { value: '' }
                        : { fileName: '', contentType: '', data: '', size: 0 }),
                    })
                  }
                >
                  <option value="text">Text</option>
                  <option value="file">File</option>
                </select>
              </td>
              <td>
                {isFile ? (
                  <div className="file-cell">
                    <input
                      ref={(element) => {
                        inputs.current[index] = element;
                      }}
                      type="file"
                      style={{ display: 'none' }}
                      onChange={(event) => attach(index, event)}
                    />
                    <button
                      type="button"
                      className="btn ghost small"
                      onClick={() => inputs.current[index]?.click()}
                    >
                      {row.fileName ? 'Replace' : 'Select file'}
                    </button>
                    {row.fileName ? (
                      <span className={`file-name${lostBytes ? ' stale' : ''}`} title={row.contentType}>
                        {row.fileName}
                        <span className="hint">
                          {lostBytes ? 'pick it again after a reload' : formatBytes(row.size)}
                        </span>
                      </span>
                    ) : (
                      <span className="hint">No file chosen</span>
                    )}
                  </div>
                ) : (
                  <input
                    type="text"
                    value={row.value ?? ''}
                    placeholder="Value"
                    onChange={(event) => patch(index, { value: event.target.value })}
                  />
                )}
              </td>
              <td className="remove">
                {list.length > 1 && (
                  <button type="button" onClick={() => remove(index)} title="Remove row">
                    ×
                  </button>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** `binary` mode: the whole body is one file. */
export function BinaryPicker({ file, onChange }) {
  const notify = useStore((state) => state.notify);
  const input = useRef(null);

  const pick = async (event) => {
    const chosen = event.target.files?.[0];
    event.target.value = '';
    if (!chosen) return;
    try {
      onChange(await readFile(chosen));
    } catch (err) {
      notify(err.message, 'error');
    }
  };

  const lostBytes = Boolean(file?.fileName && !file.data);

  return (
    <div className="binary-picker">
      <input ref={input} type="file" style={{ display: 'none' }} onChange={pick} />
      <button type="button" className="btn" onClick={() => input.current?.click()}>
        {file?.fileName ? 'Replace file' : 'Select a file'}
      </button>

      {file?.fileName ? (
        <div className="binary-file">
          <strong className={lostBytes ? 'stale' : undefined}>{file.fileName}</strong>
          <span className="hint">
            {file.contentType || 'application/octet-stream'} ·{' '}
            {lostBytes ? 'bytes were not kept — pick it again' : formatBytes(file.size)}
          </span>
        </div>
      ) : (
        <p className="hint">
          The file is sent as the raw request body. Content-Type follows the file unless you set the
          header yourself.
        </p>
      )}

      {file?.fileName && (
        <button type="button" className="btn ghost small" onClick={() => onChange(null)}>
          Remove
        </button>
      )}
    </div>
  );
}
