import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

interface Props {
  open: boolean;
  onClose: () => void;
  /** id of the element naming this dialog, for aria-labelledby. */
  labelledBy: string;
  children: ReactNode;
  width?: number;
  /** Which focusable to land on when opening. Defaults to the first. */
  initialFocus?: 'first' | 'last';
}

/** Overlay dialog: portalled to <body>, focus-trapped, Esc- and
 *  overlay-closable, with body scroll locked while open. */
export function Modal({ open, onClose, labelledBy, children, width = 380, initialFocus = 'first' }: Props) {
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const restoreRef = useRef<HTMLElement | null>(null);

  const focusables = useCallback((): HTMLElement[] => {
    const node = dialogRef.current;
    if (!node) return [];
    return Array.from(node.querySelectorAll<HTMLElement>(FOCUSABLE));
  }, []);

  // Remember what had focus, move focus in, and hand it back on close.
  useEffect(() => {
    if (!open) return;
    restoreRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;

    const items = focusables();
    const target = initialFocus === 'last' ? items[items.length - 1] : items[0];
    (target ?? dialogRef.current)?.focus();

    return () => {
      // The previously-focused element may have been removed from the DOM
      // while the modal was open (browsers do not fire blur/focusout for
      // that — focus silently relocates to <body>). Only refocus it if it
      // is still attached; otherwise leave focus where the browser put it.
      const el = restoreRef.current;
      if (el && el.isConnected) el.focus();
    };
  }, [open, initialFocus, focusables]);

  // Esc closes, from anywhere.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: globalThis.KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Body scroll lock.
  useEffect(() => {
    if (!open) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previous; };
  }, [open]);

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (items.length === 0) return;

    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;

    if (e.shiftKey && active === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  };

  if (!open) return null;

  return createPortal(
    <div
      data-testid="modal-overlay"
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'rgba(5, 8, 13, 0.72)', backdropFilter: 'blur(2px)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 16,
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={onKeyDown}
        style={{
          width, maxWidth: '100%',
          background: 'var(--bg-surface, #1f2a3c)',
          border: '1px solid var(--border, rgba(0,200,150,0.20))',
          borderRadius: 12, padding: 22,
          boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
          animation: 'pd-modal-pop 140ms ease-out',
        }}
      >
        {children}
      </div>
      <style>{`
        @keyframes pd-modal-pop { from { opacity: 0; transform: scale(.96); } to { opacity: 1; transform: none; } }
        @media (prefers-reduced-motion: reduce) {
          @keyframes pd-modal-pop { from { opacity: 0; } to { opacity: 1; } }
        }
      `}</style>
    </div>,
    document.body,
  );
}
