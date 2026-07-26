import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { NotifyProvider } from '@pd/ui';

/**
 * Wraps NotifyProvider with a `closeLabel` that tracks the active language.
 *
 * `NotifyProvider`'s `closeLabel` prop is read once per render, and
 * shared/ui has no i18n awareness of its own — so computing it once at
 * startup (e.g. `i18n.t('notify:close')` passed directly in main.tsx) would
 * freeze the toast close button's accessible label at whatever language was
 * active when the app booted. This app switches between English and
 * Romanian at runtime, so that label would silently go stale after a
 * switch. `useTranslation()` re-renders this component on every language
 * change, keeping `closeLabel` current.
 */
export function NotifyRoot({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  return <NotifyProvider closeLabel={t('notify:close')}>{children}</NotifyProvider>;
}
