import { describe, it, expect } from 'vitest';
import { tokenExpiringSoon } from './jwt';

function base64url(s: string): string {
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
}

function makeToken(expSeconds: number): string {
  const payload = base64url(JSON.stringify({ exp: expSeconds }));
  return `a.${payload}.b`;
}

const NOW_MS = 1_000_000_000_000; // fixed "now" for stable tests
const SKEW_MS = 2 * 60 * 1000;   // 2 minutes

describe('tokenExpiringSoon', () => {
  it('returns true when token expires within the skew window', () => {
    // expires in 90 seconds — within the 2-min skew
    const expSec = Math.floor((NOW_MS + 90_000) / 1000);
    expect(tokenExpiringSoon(makeToken(expSec), NOW_MS, SKEW_MS)).toBe(true);
  });

  it('returns false when token is far from expiry', () => {
    // expires in 10 minutes — well outside the 2-min skew
    const expSec = Math.floor((NOW_MS + 10 * 60 * 1000) / 1000);
    expect(tokenExpiringSoon(makeToken(expSec), NOW_MS, SKEW_MS)).toBe(false);
  });

  it('returns true for null token', () => {
    expect(tokenExpiringSoon(null, NOW_MS, SKEW_MS)).toBe(true);
  });

  it('returns true for garbage token', () => {
    expect(tokenExpiringSoon('not-a-jwt', NOW_MS, SKEW_MS)).toBe(true);
  });

  it('returns true for token missing exp field', () => {
    const payload = base64url(JSON.stringify({ sub: 'user' }));
    expect(tokenExpiringSoon(`a.${payload}.b`, NOW_MS, SKEW_MS)).toBe(true);
  });
});
