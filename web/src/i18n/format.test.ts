// @vitest-environment happy-dom
import { describe, it, expect, beforeEach } from 'vitest';
import i18n from './index';
import { formatDate } from './format';

const D = '2024-01-15T00:00:00Z';

describe('formatDate follows i18n language', () => {
  beforeEach(() => localStorage.clear());
  it('formats per active language', async () => {
    await i18n.changeLanguage('en');
    const en = formatDate(D);
    await i18n.changeLanguage('ro');
    const ro = formatDate(D);
    // en (en-US style m/d/y) and ro (d.m.y) render the same date differently
    expect(en).not.toBe(ro);
    expect(ro).toContain('15'); // day-first in ro
  });
});
