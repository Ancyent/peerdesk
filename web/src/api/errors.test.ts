// @vitest-environment happy-dom
import { describe, it, expect } from 'vitest';
import i18n from '../i18n';
import { ApiError } from './client';
import { localizeError } from './errors';

describe('localizeError', () => {
  it('maps a known server message to the errors catalog', async () => {
    await i18n.changeLanguage('en');
    expect(localizeError(new ApiError(409, 'Email already in use')))
      .toBe(i18n.t('errors:server.emailInUse'));
  });
  it('passes an unknown ApiError message through unchanged', () => {
    expect(localizeError(new ApiError(500, 'Weird backend text'))).toBe('Weird backend text');
  });
  it('returns a generic message for a non-ApiError', () => {
    expect(localizeError(new Error('boom'))).toBe(i18n.t('common:error'));
  });
});
