// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import i18n from './index';

describe('language switching', () => {
  beforeEach(() => localStorage.clear());

  it('changeLanguage updates active language and caches to localStorage.lang', async () => {
    await i18n.changeLanguage('ro');
    expect(i18n.language).toBe('ro');
    expect(localStorage.getItem('lang')).toBe('ro');
    await i18n.changeLanguage('en');
    expect(i18n.language).toBe('en');
    expect(localStorage.getItem('lang')).toBe('en');
  });

  it('common namespace resolves per language', async () => {
    await i18n.changeLanguage('ro');
    expect(i18n.t('common:save')).toBe('Salvează');
    await i18n.changeLanguage('en');
    expect(i18n.t('common:save')).toBe('Save');
  });
});
