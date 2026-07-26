import type { RefObject } from 'react';
import type { Toast } from './toastStore';
import type { ToastKind } from './types';

const ACCENT: Record<ToastKind, string> = {
  success: 'var(--green, #00e5a0)',
  error: 'var(--red, #f87171)',
  warning: 'var(--yellow, #fbbf24)',
  info: 'var(--accent-2, #00a8ff)',
};

const GLYPH: Record<ToastKind, string> = {
  success: '✓',
  error: '✕',
  warning: '⚠',
  info: 'i',
};

interface Props {
  toasts: Toast[];
  onDismiss: (id: number) => void;
  /** Reports hover state only. Focus is intentionally NOT reported through
   *  an event here — see `hostRef` below. */
  onHoverChange: (hovered: boolean) => void;
  /** Attached to the outer container so the caller can derive "is focus
   *  currently inside the host" on demand (`hostRef.current?.contains(
   *  document.activeElement)`), instead of tracking it via focus/blur
   *  events. Blur/focusout are not reliably delivered when the focused
   *  element (e.g. a toast's close button, focused right before it's
   *  clicked) is removed from the DOM — some environments update
   *  `document.activeElement` on removal without ever queuing the event.
   *  Polling the live DOM at tick time sidesteps that gap entirely. */
  hostRef: RefObject<HTMLDivElement | null>;
  closeLabel: string;
}

/** Bottom-right stack. Hovering or focusing pauses every running timer, so a
 *  toast can't expire out from under someone who is reading it — the two
 *  are independent: hover is reported live via `onHoverChange`, and focus
 *  is read on demand via `hostRef` (see above), so neither can override the
 *  other (e.g. mouse leaving while focus remains inside must still pause).
 *
 *  The container always renders, even with zero toasts, so `hostRef`
 *  keeps pointing at a live, still-hoverable element between toasts rather
 *  than going stale. An empty container has no children, so with
 *  `pointerEvents: 'none'` and no set height it occupies no visible space
 *  and intercepts nothing. */
export function ToastHost({ toasts, onDismiss, onHoverChange, hostRef, closeLabel }: Props) {
  return (
    <div
      ref={hostRef}
      data-testid="toast-host"
      onMouseEnter={() => onHoverChange(true)}
      onMouseLeave={() => onHoverChange(false)}
      style={{
        position: 'fixed', right: 16, bottom: 16, zIndex: 1100,
        display: 'flex', flexDirection: 'column', gap: 8,
        maxWidth: 'min(380px, calc(100vw - 32px))', pointerEvents: 'none',
      }}
    >
      {toasts.map((t) => (
        <div
          key={t.id}
          data-testid="toast"
          data-kind={t.kind}
          aria-live={t.kind === 'error' ? 'assertive' : 'polite'}
          style={{
            pointerEvents: 'auto',
            display: 'flex', alignItems: 'flex-start', gap: 10,
            background: 'var(--bg-surface, #1f2a3c)',
            border: '1px solid var(--border, rgba(0,200,150,0.20))',
            borderLeft: `3px solid ${ACCENT[t.kind]}`,
            borderRadius: 10, padding: '11px 12px',
            boxShadow: '0 10px 30px rgba(0,0,0,0.45)',
            animation: 'pd-toast-in 160ms ease-out',
          }}
        >
          <span aria-hidden="true" style={{ color: ACCENT[t.kind], fontSize: 13, lineHeight: '18px', flexShrink: 0 }}>
            {GLYPH[t.kind]}
          </span>

          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-1, #fff)', lineHeight: 1.4 }}>
              {t.message}
              {t.count > 1 && (
                <span style={{ marginLeft: 6, fontSize: 11, fontWeight: 700, color: ACCENT[t.kind] }}>
                  &times;{t.count}
                </span>
              )}
            </div>
            {t.detail && (
              <div style={{ fontSize: 12, color: 'var(--text-3, #93a1b5)', marginTop: 3, lineHeight: 1.45, wordBreak: 'break-word' }}>
                {t.detail}
              </div>
            )}
          </div>

          <button
            data-testid="toast-close"
            onClick={() => onDismiss(t.id)}
            aria-label={closeLabel}
            style={{
              flexShrink: 0, background: 'transparent', border: 'none', cursor: 'pointer',
              color: 'var(--text-3, #93a1b5)', fontSize: 15, lineHeight: '18px', padding: 0,
            }}
          >
            &times;
          </button>
        </div>
      ))}

      <style>{`
        @keyframes pd-toast-in { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) {
          @keyframes pd-toast-in { from { opacity: 0; } to { opacity: 1; } }
        }
      `}</style>
    </div>
  );
}
