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
  const [paused, setPaused] = useState(false);

  // Kept in a ref (rather than read directly in the effect below) purely so
  // the notify-effect doesn't need to depend on `onExternal` identity; the
  // ref itself is written from an effect, never during render, so it stays
  // pure under concurrent rendering.
  const externalRef = useRef(onExternal);
  useEffect(() => {
    externalRef.current = onExternal;
  }, [onExternal]);

  useEffect(() => {
    if (paused) return;
    const h = setInterval(() => setState((s) => tickToasts(s, TICK_MS)), TICK_MS);
    return () => clearInterval(h);
  }, [paused]);

  // Safety net: an empty stack has nothing left to hover or focus, so it can
  // never legitimately stay paused. This guards against `paused` latching on
  // when the DOM element that was hovered/focused gets removed without ever
  // delivering `mouseleave`/`blur` — a real gap in some environments (not
  // just this one) since those events are tied to pointer/focus movement,
  // not to DOM mutation.
  const isEmpty = state.visible.length === 0 && state.queued.length === 0;
  useEffect(() => {
    if (isEmpty) setPaused(false);
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
        onPauseChange={setPaused}
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
