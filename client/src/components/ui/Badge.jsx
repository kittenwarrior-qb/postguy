export function Badge({ tone, className = '', children, ...props }) {
  const classes = ['badge', tone, className].filter(Boolean).join(' ');
  return (
    <span className={classes} {...props}>
      {children}
    </span>
  );
}
