import { useCallback, useEffect, useRef } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** The dialog shell's own surface recipe, read from reserved tokens.
 *
 *  This deliberately does not call surfaceStyle() from Surface.tsx. That helper
 *  reads --surface-*, which an uploaded theme is allowed to set, so a Modal
 *  rendered through it could be blanked by a theme that never selected it —
 *  and Modal is what ConfirmDialog renders inside. --pd-sys-* tokens cannot be
 *  set by a theme (RESERVED_TOKEN_PREFIX in server/api/themes/surface.py), and
 *  keeping the recipe here rather than importing it also means Modal has no
 *  edge to a themeable module at all. */
const DIALOG_SURFACE = {
  background: 'var(--pd-sys-surface-bg, #172131)',
  border: 'var(--pd-sys-surface-border, 1px solid rgba(148,176,200,0.14))',
  boxShadow: 'var(--pd-sys-surface-shadow, 0 10px 30px -8px rgb(0 0 0 / 0.5))',
  backdropFilter: 'var(--pd-sys-surface-blur, none)',
  WebkitBackdropFilter: 'var(--pd-sys-surface-blur, none)',
  borderRadius: 'var(--pd-sys-radius, 12px)',
} as const;

const FOCUSABLE =
  'a[href],button:not([disabled]),textarea:not([disabled]),input:not([disabled]),select:not([disabled]),[tabindex]:not([tabindex="-1"])';

// Body scroll lock, reference-counted at module scope so two Modals can be
// open concurrently (e.g. a confirm dialog opened over another modal)
// without one closing first and unlocking scroll out from under the other.
let scrollLockCount = 0;
let scrollLockPreviousOverflow = '';

function acquireScrollLock() {
  if (scrollLockCount === 0) {
    scrollLockPreviousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
  }
  scrollLockCount += 1;
}

function releaseScrollLock() {
  scrollLockCount = Math.max(0, scrollLockCount - 1);
  if (scrollLockCount === 0) {
    document.body.style.overflow = scrollLockPreviousOverflow;
  }
}

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

  // Body scroll lock — reference-counted so concurrently-open Modals don't
  // unlock scroll for each other when one closes first.
  useEffect(() => {
    if (!open) return;
    acquireScrollLock();
    return () => { releaseScrollLock(); };
  }, [open]);

  // Tracks whether the current mousedown-click sequence on the overlay
  // started inside the dialog (e.g. a text selection drag whose mouseup
  // lands on the backdrop). The browser resolves such a click's target to
  // the nearest common ancestor of the mousedown/mouseup targets — the
  // overlay — bypassing the dialog's stopPropagation, so we must detect and
  // ignore it explicitly rather than close the modal underneath the user.
  const startedInsideDialog = useRef(false);

  const onDialogMouseDown = () => { startedInsideDialog.current = true; };

  const onOverlayMouseDown = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (e.target === e.currentTarget) startedInsideDialog.current = false;
  };

  const onOverlayClick = () => {
    if (startedInsideDialog.current) {
      startedInsideDialog.current = false;
      return;
    }
    onClose();
  };

  const onKeyDown = (e: ReactKeyboardEvent) => {
    if (e.key !== 'Tab') return;
    const items = focusables();
    if (items.length === 0) {
      // No focusable descendants: the dialog itself (tabIndex={-1}) is the
      // only thing that should hold focus. Without preventDefault here the
      // browser's default Tab behavior takes over — since the dialog is
      // outside the normal tab order, focus escapes to the page behind the
      // overlay.
      e.preventDefault();
      dialogRef.current?.focus();
      return;
    }

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
      onMouseDown={onOverlayMouseDown}
      onClick={onOverlayClick}
      style={{
        position: 'fixed', inset: 0, zIndex: 1200,
        background: 'var(--pd-sys-overlay, rgba(5, 8, 13, 0.72))',
        // Written twice because nothing in the toolchain adds vendor prefixes,
        // and WebKitGTK - the engine behind the desktop window - only ships the
        // prefixed property. Unprefixed alone, the blur vanished silently there
        // while looking correct in Chromium.
        backdropFilter: 'blur(2px)', WebkitBackdropFilter: 'blur(2px)',
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
        onMouseDown={onDialogMouseDown}
        onKeyDown={onKeyDown}
        style={{
          ...DIALOG_SURFACE,
          width, maxWidth: '100%',
          padding: 22,
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
