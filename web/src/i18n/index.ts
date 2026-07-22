import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';
import LanguageDetector from 'i18next-browser-languagedetector';

// Auto-load every locale catalog. Adding a namespace = dropping a JSON file
// under locales/<lng>/<ns>.json — no edit here.
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

i18n
  .use(LanguageDetector)
  .use(initReactI18next)
  .init({
    resources,
    supportedLngs: SUPPORTED_LANGUAGES as unknown as string[],
    fallbackLng: 'en',
    load: 'languageOnly',
    defaultNS: 'common',
    ns: ['common'],
    interpolation: { escapeValue: false }, // React already escapes
    detection: {
      order: ['localStorage', 'navigator'],
      lookupLocalStorage: 'lang',
      caches: ['localStorage'],
    },
    react: { useSuspense: false },
  });

export default i18n;
