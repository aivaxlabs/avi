import { createContext, useContext, useEffect, useState } from 'react';

const ClosingContext = createContext(false);
const overlayCloseDuration = 150;

// `value` must be referentially stable (state, props, or primitives): a new
// inline object on every render would keep replacing the retained value.
export function usePresence(value, duration = overlayCloseDuration) {
  const [retained, setRetained] = useState(value);
  if (value && value !== retained) setRetained(value);

  useEffect(() => {
    if (value || !retained) return undefined;
    const timer = window.setTimeout(
      () => setRetained(null),
      window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 0 : duration,
    );
    return () => window.clearTimeout(timer);
  }, [duration, retained, value]);

  return [value || retained, !value && Boolean(retained)];
}

export function Presence({ when, duration, children }) {
  const [value, closing] = usePresence(when, duration);
  const parentClosing = useContext(ClosingContext);
  if (!value) return null;

  return (
    <ClosingContext value={closing || parentClosing}>
      {children(value)}
    </ClosingContext>
  );
}

export function Overlay({ as: Element = 'div', ...props }) {
  const closing = useContext(ClosingContext);

  return (
    <Element
      {...props}
      data-closing={closing || undefined}
      inert={closing || undefined}
    />
  );
}
