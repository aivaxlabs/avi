export function ComposerFloatButtonStrip({ children, label = 'Chat actions' }) {
  return (
    <div className="composer-float-button-strip" role="group" aria-label={label}>
      {children}
    </div>
  );
}

export function ComposerFloatButton({
  icon: Icon,
  children,
  label,
  ...props
}) {
  const text = children ?? label;

  return (
    <button type="button" className="composer-float-button" {...props}>
      {Icon ? <Icon size={14} aria-hidden="true" /> : null}
      {text ? <span>{text}</span> : null}
    </button>
  );
}
