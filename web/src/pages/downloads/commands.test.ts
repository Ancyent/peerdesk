import { describe, it, expect } from 'vitest';
import { buildCommand } from './commands';

const ctx = { origin: 'http://192.168.200.223', token: 'ABCD-1234' };

describe('buildCommand', () => {
  it('linux one-liner with flags', () => {
    expect(buildCommand('linux', ctx)).toBe(
      'curl -sSL http://192.168.200.223/install.sh | sudo bash -s -- --server=http://192.168.200.223 --token=ABCD-1234');
  });
  it('windows scriptblock invocation', () => {
    expect(buildCommand('windows', ctx)).toBe(
      '& ([scriptblock]::Create((irm http://192.168.200.223/install.ps1))) -Server "http://192.168.200.223" -Token "ABCD-1234"');
  });
  it('no token → empty string', () => {
    expect(buildCommand('linux', { origin: 'http://x', token: null })).toBe('');
  });
  it('android → empty (no CLI deploy)', () => {
    expect(buildCommand('android', ctx)).toBe('');
  });
});
