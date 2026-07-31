export type { Tone, ToastKind } from './types';
export type { Toast, ToastInput, ToastState } from './toastStore';
export {
  emptyToastState, addToast, dismissToast, tickToasts,
  MAX_VISIBLE, DEDUP_WINDOW_MS, DEFAULT_DURATION_MS,
} from './toastStore';

/** Bumped only when the shared surface changes incompatibly. Also serves as
 *  the smoke value proving the @pd/ui alias resolves in a consuming app. */
export const SHARED_UI_VERSION = 2;

export type { Theme } from './theme';
export {
  applyTheme, resolveTheme, getStoredTheme, setStoredTheme, watchSystemTheme,
  THEME_STORAGE_KEY,
} from './theme';

export { styleOnce } from './styleOnce';

export type { ButtonVariant } from './Button';
export { Button } from './Button';

export { Input } from './Input';

export type { SurfaceKind } from './Surface';
export { Surface, surfaceStyle } from './Surface';

export type { NotifyApi, NotifyOptions } from './NotifyProvider';
export { NotifyProvider, useNotify } from './NotifyProvider';
export { ToastHost } from './ToastHost';

export { Modal } from './Modal';

export type { ConfirmOptions } from './ConfirmDialog';
export { ConfirmDialog } from './ConfirmDialog';
export { ConfirmProvider, useConfirm } from './ConfirmProvider';

export { InlineError } from './InlineError';
