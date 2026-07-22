import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

const modules = import.meta.glob('./locales/*/*.json', { eager: true }) as Record<
  string,
  { default: Record<string, unknown> }
>;
const resources: Record<string, Record<string, Record<string, unknown>>> = {};
for (const path in modules) {
  const m = /\.\/locales\/([^/]+)\/([^/]+)\.json$/.exec(path);
  if (!m) continue;
  const [, lng, ns] = m;
  (resources[lng] ??= {})[ns] = modules[path].default;
}

export const SUPPORTED_LANGUAGES = ['en', 'ro'] as const;
export type Language = (typeof SUPPORTED_LANGUAGES)[number];

/** Resolve the initial language: an explicit setting wins; else the OS/webview
 *  locale if supported; else English. Called by AppContext once settings load. */
export function resolveLanguage(settingLanguage?: string | null): Language {
  if (settingLanguage === 'en' || settingLanguage === 'ro') return settingLanguage;
  const os = (navigator.language || 'en').split('-')[0];
  return os === 'ro' ? 'ro' : 'en';
}

i18n.use(initReactI18next).init({
  resources,
  supportedLngs: [...SUPPORTED_LANGUAGES],
  fallbackLng: 'en',
  load: 'languageOnly',
  defaultNS: 'common',
  ns: ['common'],
  lng: 'en', // real language applied once AppSettings load (resolveLanguage)
  interpolation: { escapeValue: false },
  react: { useSuspense: false },
});

export default i18n;
