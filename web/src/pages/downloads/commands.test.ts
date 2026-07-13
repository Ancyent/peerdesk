import { describe, it, expect } from 'vitest';
import { buildCommand } from './commands';

const ctx = { origin: 'http://192.168.200.223', token: 'ABCD-1234' };

describe('buildCommand', () => {
  it('linux one-liner with flags', () => {
    expect(buildCommand('linux', ctx)).toBe(
      'curl -sSL http://192.168.200.223/install.sh | sudo bash -s -- --server=http://192.168.200.223 --api-key=ABCD-1234');
  });
  it('windows scriptblock invocation', () => {
    expect(buildCommand('windows', ctx)).toBe(
      '& ([scriptblock]::Create((irm http://192.168.200.223/install.ps1))) -Server "http://192.168.200.223" -ApiKey "ABCD-1234"');
  });
  it('no token → empty string', () => {
    expect(buildCommand('linux', { origin: 'http://x', token: null })).toBe('');
  });
  it('android → empty (no CLI deploy)', () => {
    expect(buildCommand('android', ctx)).toBe('');
  });

  it('linux appends --password (shell-quoted) and --headless', () => {
    const cmd = buildCommand('linux', { ...ctx, password: 'Secret 1', mode: 'headless' });
    expect(cmd).toContain("--password='Secret 1'");
    expect(cmd.endsWith('--headless')).toBe(true);
  });
  it('linux --gui when mode=gui, nothing when auto', () => {
    expect(buildCommand('linux', { ...ctx, mode: 'gui' }).endsWith('--gui')).toBe(true);
    expect(buildCommand('linux', { ...ctx, mode: 'auto' })).not.toContain('--headless');
    expect(buildCommand('linux', { ...ctx, mode: 'auto' })).not.toContain('--gui');
  });
  it('escapes a single quote in the linux password', () => {
    expect(buildCommand('linux', { ...ctx, password: "a'b" })).toContain(`--password='a'\\''b'`);
  });
  it('windows appends -Password (double-quoted), ignores mode', () => {
    const cmd = buildCommand('windows', { ...ctx, password: 'Secret1', mode: 'headless' });
    expect(cmd).toContain('-Password "Secret1"');
    expect(cmd).not.toContain('headless');
  });
});
