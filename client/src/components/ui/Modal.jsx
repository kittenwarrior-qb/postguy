export function Modal({ title, onClose, className = '', children, footer, width }) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div
        className={['modal', className].filter(Boolean).join(' ')}
        style={width ? { width } : undefined}
        onClick={(event) => event.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-label={title}
      >
        <div className="modal-head">
          <span>{title}</span>
          <button type="button" className="btn ghost small" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}
