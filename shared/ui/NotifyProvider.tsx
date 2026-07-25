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

  const externalRef = useRef(onExternal);
  externalRef.current = onExternal;

  useEffect(() => {
    if (paused) return;
    const h = setInterval(() => setState((s) => tickToasts(s, TICK_MS)), TICK_MS);
    return () => clearInterval(h);
  }, [paused]);

  const push = useCallback((input: ToastInput) => {
    setState((s) => {
      const next = addToast(s, input);
      // Only a genuinely new toast bumps nextId; a dedup hit must not re-fire.
      if (next.nextId !== s.nextId) {
        const created = [...next.visible, ...next.queued].find((t) => t.id === s.nextId);
        if (created) externalRef.current?.(created);
      }
      return next;
    });
  }, []);

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
