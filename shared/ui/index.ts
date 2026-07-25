export type { Tone, ToastKind } from './types';
export type { Toast, ToastInput, ToastState } from './toastStore';
export {
  emptyToastState, addToast, dismissToast, tickToasts,
  MAX_VISIBLE, DEDUP_WINDOW_MS, DEFAULT_DURATION_MS,
} from './toastStore';

/** Bumped only when the shared surface changes incompatibly. Also serves as
 *  the smoke value proving the @pd/ui alias resolves in a consuming app. */
export const SHARED_UI_VERSION = 1;
