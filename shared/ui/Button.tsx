import type { CSSProperties, ReactNode } from 'react';
import { styleOnce } from './styleOnce';

export type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'icon';

/* Interaction lives in a stylesheet rather than in onMouseEnter handlers. The
 * app currently does the opposite - 14 imperative hover handlers against 2 real
 * :hover rules - which is why hover behaves differently per button today.
 *
 * Attribute hooks rather than classes: the repo has zero className usage, and
 * data-* matches the existing data-testid idiom.
 *
 * Every animated property is transform or opacity. Never box-shadow or filter:
 * those repaint, and this component ends up over a live video stream. */
const CSS = `
[data-pd-btn] {
  position: relative;
  display: inline-grid;
  place-items: center;
  font: inherit;
  font-size: 14px;
  font-weight: 550;
  line-height: 1;
  cursor: pointer;
  border-radius: 9px;
  border: 1px solid transparent;
  transition: transform 140ms ease-out, box-shadow 140ms ease-out,
              background-color 140ms ease-out, opacity 140ms ease-out,
              border-color 140ms ease-out;
}

/* Label, spinner and check share one grid cell so swapping them cannot change
   the button's width - a loading button that resizes shifts its neighbours. */
[data-pd-btn] > [data-pd-slot] {
  grid-area: 1 / 1;
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 7px;
  transition: opacity 140ms ease-out;
}

[data-pd-btn]:hover:not(:disabled) {
  transform: translateY(-1px);
  box-shadow: 0 6px 18px -6px rgb(0 0 0 / 0.45);
}

[data-pd-btn]:active:not(:disabled) {
  transform: scale(0.97);
  transition-duration: 90ms;
  box-shadow: none;
}

[data-pd-btn]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}

[data-pd-btn]:disabled {
  cursor: not-allowed;
  opacity: 0.45;
  transform: none;
  box-shadow: none;
}

@keyframes pd-btn-spin { to { transform: rotate(360deg); } }

@keyframes pd-btn-check {
  0%   { transform: scale(0.6); opacity: 0; }
  55%  { transform: scale(1.12); opacity: 1; }
  100% { transform: scale(1); opacity: 1; }
}

@media (prefers-reduced-motion: reduce) {
  [data-pd-btn] { transition: opacity 140ms ease-out; }
  [data-pd-btn]:hover:not(:disabled) { transform: none; box-shadow: none; opacity: 0.86; }
  [data-pd-btn]:active:not(:disabled) { transform: none; opacity: 0.7; }
  [data-pd-spinner] { animation-duration: 1.6s; }
  @keyframes pd-btn-check { from { opacity: 0; } to { opacity: 1; } }
}
`;

const SKIN: Record<ButtonVariant, CSSProperties> = {
  primary: { background: 'var(--accent)', color: 'var(--accent-ink)' },
  secondary: { background: 'var(--bg-hover)', color: 'var(--text-1)', borderColor: 'var(--border-dim)' },
  danger: { background: 'var(--red)', color: 'var(--danger-ink)' },
  ghost: { background: 'transparent', color: 'var(--text-2)' },
  icon: { background: 'transparent', color: 'var(--text-2)' },
};

const SIZING: Record<ButtonVariant, CSSProperties> = {
  primary: { padding: '9px 16px' },
  secondary: { padding: '9px 16px' },
  danger: { padding: '9px 16px' },
  ghost: { padding: '9px 14px' },
  icon: { padding: 0, width: 34, height: 34 },
};

function Spinner() {
  return (
    <span
      data-pd-spinner
      aria-hidden
      style={{
        width: 14, height: 14, borderRadius: '50%',
        border: '2px solid currentColor', borderTopColor: 'transparent',
        opacity: 0.9, animation: 'pd-btn-spin 640ms linear infinite',
      }}
    />
  );
}

function Check() {
  return (
    <svg width="15" height="15" viewBox="0 0 16 16" aria-hidden style={{ animation: 'pd-btn-check 260ms ease-out' }}>
      <path d="M3.5 8.5l3 3 6-6.5" fill="none" stroke="currentColor" strokeWidth="2"
            strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface Props {
  variant?: ButtonVariant;
  /** Swaps the label for a spinner without changing the button's width. */
  loading?: boolean;
  /** Brief confirmation tick. Caller owns the timeout back to false. */
  success?: boolean;
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
  'aria-label'?: string;
  children?: ReactNode;
  style?: CSSProperties;
  onClick?: () => void;
}

export function Button({
  variant = 'primary', loading = false, success = false, disabled = false,
  type = 'button', title, children, style, onClick, ...rest
}: Props) {
  styleOnce('pd-button', CSS);

  return (
    <button
      type={type}
      data-pd-btn
      title={title}
      aria-label={rest['aria-label']}
      // A button mid-request must not fire again, whatever the caller passed.
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      onClick={onClick}
      style={{ ...SIZING[variant], ...SKIN[variant], ...style }}
    >
      <span data-pd-slot style={{ opacity: loading || success ? 0 : 1 }}>{children}</span>
      <span data-pd-slot aria-hidden={!loading} style={{ opacity: loading ? 1 : 0 }}>
        {loading ? <Spinner /> : null}
      </span>
      <span data-pd-slot aria-hidden={!success} style={{ opacity: success ? 1 : 0 }}>
        {success ? <Check /> : null}
      </span>
    </button>
  );
}
