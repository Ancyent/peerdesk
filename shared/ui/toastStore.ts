import type { ToastKind } from './types';

export interface Toast {
  id: number;
  kind: ToastKind;
  message: string;
  detail?: string;
  /** How many identical messages collapsed into this one. Starts at 1. */
  count: number;
  /** Milliseconds left before auto-dismiss. Meaningless when `expires` is false. */
  remainingMs: number;
  /** Milliseconds this toast has been visible. Drives the dedup window. */
  ageMs: number;
  /** False for errors, which persist until the user dismisses them. */
  expires: boolean;
}

export interface ToastInput {
  kind: ToastKind;
  message: string;
  detail?: string;
  durationMs?: number;
}

export interface ToastState {
  visible: Toast[];
  queued: Toast[];
  nextId: number;
}

export const MAX_VISIBLE = 4;
export const DEDUP_WINDOW_MS = 3000;

/** An error that vanishes on its own is an error the user never read, so
 *  errors get duration 0 — meaning "never auto-dismiss". */
export const DEFAULT_DURATION_MS: Record<ToastKind, number> = {
  success: 4000,
  info: 4000,
  warning: 6000,
  error: 0,
};

export const emptyToastState = (): ToastState => ({ visible: [], queued: [], nextId: 1 });

/** Move queued toasts into free visible slots. Their timers start here. */
function promote(state: ToastState): ToastState {
  if (state.queued.length === 0 || state.visible.length >= MAX_VISIBLE) return state;
  const room = MAX_VISIBLE - state.visible.length;
  return {
    ...state,
    visible: [...state.visible, ...state.queued.slice(0, room)],
    queued: state.queued.slice(room),
  };
}

export function addToast(state: ToastState, input: ToastInput): ToastState {
  const duration = input.durationMs ?? DEFAULT_DURATION_MS[input.kind];

  const dupIndex = state.visible.findIndex(
    (t) => t.kind === input.kind && t.message === input.message && t.ageMs <= DEDUP_WINDOW_MS,
  );
  if (dupIndex !== -1) {
    const visible = state.visible.slice();
    const dup = visible[dupIndex];
    visible[dupIndex] = { ...dup, count: dup.count + 1, remainingMs: duration, ageMs: 0 };
    return { ...state, visible };
  }

  const toast: Toast = {
    id: state.nextId,
    kind: input.kind,
    message: input.message,
    detail: input.detail,
    count: 1,
    remainingMs: duration,
    ageMs: 0,
    expires: duration > 0,
  };

  const next: ToastState = { ...state, nextId: state.nextId + 1 };
  return state.visible.length < MAX_VISIBLE
    ? { ...next, visible: [...next.visible, toast] }
    : { ...next, queued: [...next.queued, toast] };
}

export function dismissToast(state: ToastState, id: number): ToastState {
  return promote({
    ...state,
    visible: state.visible.filter((t) => t.id !== id),
    queued: state.queued.filter((t) => t.id !== id),
  });
}

/** Advance time. Only visible toasts age; queued ones wait untouched. */
export function tickToasts(state: ToastState, deltaMs: number): ToastState {
  const visible = state.visible
    .map((t) => ({
      ...t,
      ageMs: t.ageMs + deltaMs,
      remainingMs: t.expires ? t.remainingMs - deltaMs : t.remainingMs,
    }))
    .filter((t) => !t.expires || t.remainingMs > 0);

  return promote({ ...state, visible });
}
