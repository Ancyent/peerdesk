// Native language display names (autonyms). These are intentionally NOT
// translated — each language is shown in its own script so speakers recognize
// it regardless of the current UI language. This is the single home for such
// autonyms; the anti-Romanian source gate excludes this file.
import { SUPPORTED_LANGUAGES, type Language } from './index';

export const LANGUAGE_NAMES: Record<Language, string> = {
  en: 'English',
  ro: 'Română',
};

export { SUPPORTED_LANGUAGES };
export type { Language };
