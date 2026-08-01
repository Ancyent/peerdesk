import type { CSSProperties } from 'react';
import { styleOnce } from './styleOnce';

/* One declaration replacing three that had drifted apart: InvitePage.tsx:14
 * (15px, --bg-surface, no width), SettingsPage.tsx:10 (13px, --bg-hover, 100%)
 * and BrandingPage.tsx:90 (14px, --bg-surface, 100%, rebuilt on every render
 * because it was declared inside the component body).
 *
 * 14px and --bg-hover win; full width and border-box come from the two that had
 * them, since an input that does not fill its field is the exception. */
const CSS = `
[data-pd-input] {
  font: inherit;
  font-size: 14px;
  padding: 9px 12px;
  width: 100%;
  box-sizing: border-box;
  border-radius: 8px;
  background: var(--bg-hover);
  border: 1px solid var(--border-dim);
  color: var(--text-1);
  outline: none;
  transition: border-color 140ms ease-out, box-shadow 140ms ease-out;
}

[data-pd-input]::placeholder { color: var(--text-3); }

[data-pd-input]:focus {
  border-color: var(--accent);
  box-shadow: 0 0 0 1px var(--accent);
}

[data-pd-input][aria-invalid='true'] {
  border-color: var(--red);
  box-shadow: 0 0 0 1px var(--red);
}

[data-pd-input]:disabled { cursor: not-allowed; opacity: 0.5; }

@media (prefers-reduced-motion: reduce) {
  [data-pd-input] { transition: none; }
}
`;

interface Props {
  value: string;
  onChange: (value: string) => void;
  type?: 'text' | 'email' | 'password' | 'number';
  placeholder?: string;
  /** Renders the invalid state and, when a string, the message under it. */
  error?: string | boolean;
  disabled?: boolean;
  label?: string;
  id?: string;
  autoComplete?: string;
  style?: CSSProperties;
  onKeyDown?: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}

export function Input({
  value, onChange, type = 'text', placeholder, error, disabled = false,
  label, id, autoComplete, style, onKeyDown,
}: Props) {
  styleOnce('pd-input', CSS);

  const invalid = Boolean(error);
  const field = (
    <input
      data-pd-input
      id={id}
      type={type}
      value={value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={onKeyDown}
      placeholder={placeholder}
      disabled={disabled}
      autoComplete={autoComplete}
      aria-invalid={invalid || undefined}
      style={style}
    />
  );

  if (!label && !error) return field;

  return (
    <label style={{ display: 'grid', gap: 6 }} htmlFor={id}>
      {label ? <span style={{ fontSize: 12, color: 'var(--text-3)' }}>{label}</span> : null}
      {field}
      {typeof error === 'string' && error
        ? <span style={{ fontSize: 12, color: 'var(--red)' }}>{error}</span>
        : null}
    </label>
  );
}
