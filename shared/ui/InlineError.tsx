import type { ReactNode } from 'react';

/** Form-level error text, rendered next to the field or form it describes. */
export function InlineError({ children }: { children?: ReactNode }) {
  if (children === undefined || children === null || children === '') return null;

  return (
    <p
      role="alert"
      style={{ color: 'var(--red, #f87171)', margin: 0, fontSize: 14, lineHeight: 1.45 }}
    >
      {children}
    </p>
  );
}
