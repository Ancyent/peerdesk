import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { ConfirmDialog } from './ConfirmDialog';
import type { ConfirmOptions } from './ConfirmDialog';

type ConfirmFn = (options: ConfirmOptions) => Promise<boolean>;

const ConfirmContext = createContext<ConfirmFn | null>(null);

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [options, setOptions] = useState<ConfirmOptions | null>(null);
  const pending = useRef<((accepted: boolean) => void) | null>(null);

  const confirm = useCallback<ConfirmFn>((opts) => {
    // One dialog at a time. A second call resolves false rather than rejecting:
    // a rejected promise inside a click handler becomes an unhandled rejection,
    // and false is the safe answer because it means "nothing happens".
    if (pending.current) return Promise.resolve(false);

    setOptions(opts);
    return new Promise<boolean>((resolve) => { pending.current = resolve; });
  }, []);

  const onSettle = useCallback((accepted: boolean) => {
    const resolve = pending.current;
    pending.current = null;
    setOptions(null);
    resolve?.(accepted);
  }, []);

  // If the provider unmounts while a confirm is still pending, settle it
  // false rather than leaving the caller's promise unresolved forever. A
  // hung await would otherwise strand any code past the `await confirm(...)`
  // call, and false is the same "nothing happens" answer used everywhere
  // else in this module for an unresolvable prompt.
  useEffect(() => {
    return () => {
      const resolve = pending.current;
      pending.current = null;
      resolve?.(false);
    };
  }, []);

  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {options && <ConfirmDialog open options={options} onSettle={onSettle} />}
    </ConfirmContext.Provider>
  );
}

export function useConfirm(): ConfirmFn {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used inside a ConfirmProvider');
  return ctx;
}
