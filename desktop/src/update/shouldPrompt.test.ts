import { describe, it, expect } from 'vitest';
import { cmpVer, shouldPrompt } from './shouldPrompt';

describe('cmpVer', () => {
  it('orders numeric dotted versions', () => {
    expect(cmpVer('0.5.0', '0.4.33')).toBe(1);
    expect(cmpVer('0.4.0', '0.4.0')).toBe(0);
    expect(cmpVer('0.4.2', '0.4.10')).toBe(-1);
  });
});

describe('shouldPrompt', () => {
  const base = { current: '0.4.0', latest: '0.5.0', skipVersion: '', snoozeUntil: null, now: 1000 };
  it('prompts when a newer version exists', () => {
    expect(shouldPrompt(base)).toBe(true);
  });
  it('does not prompt when up to date or older', () => {
    expect(shouldPrompt({ ...base, latest: '0.4.0' })).toBe(false);
    expect(shouldPrompt({ ...base, latest: '0.3.0' })).toBe(false);
    expect(shouldPrompt({ ...base, latest: null })).toBe(false);
  });
  it('does not prompt for a skipped version', () => {
    expect(shouldPrompt({ ...base, skipVersion: '0.5.0' })).toBe(false);
    // a version newer than the skipped one still prompts
    expect(shouldPrompt({ ...base, latest: '0.6.0', skipVersion: '0.5.0' })).toBe(true);
  });
  it('respects snooze boundaries', () => {
    expect(shouldPrompt({ ...base, snoozeUntil: 2000, now: 1999 })).toBe(false);
    expect(shouldPrompt({ ...base, snoozeUntil: 2000, now: 2000 })).toBe(true);
  });
});
