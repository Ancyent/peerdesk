import i18n from './index';

/** Localized short date using the active UI language (falls back to the runtime default). */
export function formatDate(value: string | number | Date): string {
  return new Date(value).toLocaleDateString(i18n.language || undefined);
}
