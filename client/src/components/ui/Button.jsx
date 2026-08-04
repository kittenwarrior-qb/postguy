export function Button({
  variant = 'default',
  size,
  className = '',
  type = 'button',
  children,
  ...props
}) {
  const classes = ['btn', variant !== 'default' ? variant : '', size ? String(size) : '', className]
    .filter(Boolean)
    .join(' ');

  return (
    <button type={type} className={classes} {...props}>
      {children}
    </button>
  );
}
