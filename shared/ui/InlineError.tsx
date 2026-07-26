import type { ReactNode } from 'react';

interface Props {
  children?: ReactNode;
  size?: number;
}

/** Form-level error text, rendered next to the field or form it describes. */
export function InlineError({ children, size = 14 }: Props) {
  if (children === undefined || children === null || children === '') return null;

  return (
    <p
      role="alert"
      style={{ color: 'var(--red, #f87171)', margin: 0, fontSize: size, lineHeight: 1.45 }}
    >
      {children}
    </p>
  );
}
