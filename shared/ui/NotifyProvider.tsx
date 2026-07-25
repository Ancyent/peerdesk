import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ToastHost } from './ToastHost';
import type { Toast, ToastInput, ToastState } from './toastStore';
import { addToast, dismissToast, emptyToastState, tickToasts } from './toastStore';

export interface NotifyOptions {
  detail?: string;
  durationMs?: number;
}

export interface NotifyApi {
  success(message: string, opts?: NotifyOptions): void;
  error(message: string, opts?: NotifyOptions): void;
  info(message: string, opts?: NotifyOptions): void;
  warning(message: string, opts?: NotifyOptions): void;
}

interface NotifyContextValue {
  notify: NotifyApi;
}

const NotifyContext = createContext<NotifyContextValue | null>(null);

/** How often the store is advanced. Coarse on purpose — toast durations are
 *  seconds, so a finer tick would only burn renders. */
const TICK_MS = 250;

interface Props {
  children: ReactNode;
  /** Fired once per newly created toast. Desktop uses it to mirror the toast
   *  to an OS notification when the window is not focused. */
  onExternal?: (toast: Toast) => void;
  /** Accessible label for each toast's close button, translated by the host app. */
  closeLabel?: string;
}

export function NotifyProvider({ children, onExternal, closeLabel = 'Dismiss' }: Props) {
  const [state, setState] = useState<ToastState>(emptyToastState);

  // Hover and focus are two independent channels that both pause the timer;
  // combining them into one boolean (as an earlier version of this file did)
  // makes the mouse leaving the stack able to resume a toast that a
  // keyboard user is still focused on. Hover is cheap to track as a ref: it
  // only ever changes via the host's own mouse events, so nothing needs to
  // react to it — it's read fresh inside the tick below. Focus is not
  // tracked via focus/blur events at all: some environments don't reliably
  // deliver `blur`/`focusout` when the focused element (e.g. a toast's
  // close button) is removed from the DOM, which would let the pause latch
  // on forever. Instead it's read live off the DOM every tick.
  const hostRef = useRef<HTMLDivElement>(null);
  const hoveredRef = useRef(false);

  // Kept in a ref (rather than read directly in the effect below) purely so
  // the notify-effect doesn't need to depend on `onExternal` identity; the
  // ref itself is written from an effect, never during render, so it stays
  // pure under concurrent rendering.
  const externalRef = useRef(onExternal);
  useEffect(() => {
    externalRef.current = onExternal;
  }, [onExternal]);

  const isEmpty = state.visible.length === 0 && state.queued.length === 0;
  useEffect(() => {
    // Nothing to advance and nothing worth pausing for — skip the interval
    // entirely rather than ticking a no-op state update 4x/second for the
    // lifetime of the app (this provider is long-lived, e.g. the desktop
    // app's whole process).
    if (isEmpty) return;
    const h = setInterval(() => {
      const focused = hostRef.current?.contains(document.activeElement) ?? false;
      if (hoveredRef.current || focused) return;
      setState((s) => tickToasts(s, TICK_MS));
    }, TICK_MS);
    return () => clearInterval(h);
  }, [isEmpty]);

  const push = useCallback((input: ToastInput) => {
    setState((s) => addToast(s, input));
  }, []);

  // Fires `onExternal` exactly once per genuinely new toast. `addToast` only
  // bumps `nextId` on a real creation, never on a dedup bump, so the id
  // range [notifiedUpTo, state.nextId) is exactly the set of toasts created
  // since this effect last ran. This runs from an effect rather than inside
  // the `setState` updater above: React's StrictMode intentionally
  // double-invokes updater functions to catch impurities, which was firing
  // this side effect twice per toast; effects don't get that same
  // double-invocation for ordinary (non-mount) updates.
  const notifiedUpToRef = useRef(state.nextId);
  useEffect(() => {
    const from = notifiedUpToRef.current;
    const to = state.nextId;
    if (to > from) {
      const created = [...state.visible, ...state.queued].filter((t) => t.id >= from && t.id < to);
      for (const toast of created) externalRef.current?.(toast);
    }
    notifiedUpToRef.current = to;
  }, [state]);

  const notify = useMemo<NotifyApi>(() => ({
    success: (message, opts) => push({ kind: 'success', message, ...opts }),
    error:   (message, opts) => push({ kind: 'error',   message, ...opts }),
    info:    (message, opts) => push({ kind: 'info',    message, ...opts }),
    warning: (message, opts) => push({ kind: 'warning', message, ...opts }),
  }), [push]);

  const value = useMemo(() => ({ notify }), [notify]);

  const onDismiss = useCallback((id: number) => setState((s) => dismissToast(s, id)), []);

  return (
    <NotifyContext.Provider value={value}>
      {children}
      <ToastHost
        toasts={state.visible}
        onDismiss={onDismiss}
        onHoverChange={(hovered) => { hoveredRef.current = hovered; }}
        hostRef={hostRef}
        closeLabel={closeLabel}
      />
    </NotifyContext.Provider>
  );
}

export function useNotify(): NotifyContextValue {
  const ctx = useContext(NotifyContext);
  if (!ctx) throw new Error('useNotify must be used inside a NotifyProvider');
  return ctx;
}
