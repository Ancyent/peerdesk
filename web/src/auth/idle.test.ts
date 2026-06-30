import { describe, it, expect } from 'vitest';
import { isIdleExpired, IDLE_THRESHOLD_MS } from './idle';

describe('isIdleExpired', () => {
  it('false within window, true past it', () => {
    expect(isIdleExpired(1000, 1000 + IDLE_THRESHOLD_MS - 1, IDLE_THRESHOLD_MS)).toBe(false);
    expect(isIdleExpired(1000, 1000 + IDLE_THRESHOLD_MS + 1, IDLE_THRESHOLD_MS)).toBe(true);
  });
});
