// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import i18n from './index';
import roApikeys from './locales/ro/apikeys.json';

// Romanian has THREE plural categories (Intl.PluralRules('ro')):
//   0 -> few, 1 -> one, 2..19 -> few, 20+ -> other
// i18next falls back to the bare key when a required category is missing.
// These pin the "few" category (count = 3) to the dedicated `_few` string,
// not the bare key (which happens today to equal `_other`, masking the gap).
describe('Romanian plural categories for apikeys', () => {
  it('machineCount at count=3 (the "few" category) uses the _few translation', () => {
    const rendered = i18n.t('apikeys:machineCount', { count: 3, lng: 'ro' });
    expect(rendered).toBe(roApikeys.machineCount_few.replace('{{count}}', '3'));
  });

  it('revokeConfirm.withMachines at count=3 (the "few" category) uses the _few translation', () => {
    const rendered = i18n.t('apikeys:revokeConfirm.withMachines', {
      count: 3,
      name: 'X',
      lng: 'ro',
    });
    expect(rendered).toBe(
      roApikeys.revokeConfirm.withMachines_few.replace('{{count}}', '3').replace('{{name}}', 'X'),
    );
  });

  it('machineCount at count=20 (the "other" category) differs from the "few" wording', () => {
    const few = i18n.t('apikeys:machineCount', { count: 3, lng: 'ro' });
    const other = i18n.t('apikeys:machineCount', { count: 20, lng: 'ro' });
    expect(other).not.toBe(few.replace('3', '20'));
    expect(other).toBe(roApikeys.machineCount_other.replace('{{count}}', '20'));
  });
});
