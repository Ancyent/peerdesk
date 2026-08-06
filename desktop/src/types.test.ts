import { describe, it, expect } from 'vitest';
import { DEFAULT_SETTINGS } from './types';

// DEFAULT_SETTINGS is a hand-written mirror of `AppSettings::default()` in
// agent/src/config.rs. Nothing checks the two against each other at build time,
// so a default flipped on the Rust side drifts here silently -- which is
// exactly what happened when file transfer and the terminal moved to `true`.
//
// The drift is not cosmetic. useSettings falls back to DEFAULT_SETTINGS when
// `get_settings` fails, and `updateSetting` then persists the WHOLE object on
// the next toggle. A stale `false` therefore writes a denial the host never
// chose, for a capability they were using a minute ago.
describe('DEFAULT_SETTINGS mirrors the agent defaults', () => {
  it('permits the capabilities that worked before enforcement', () => {
    expect(
      DEFAULT_SETTINGS.allow_file_transfer,
      'file transfer ran unconditionally before this feature -- a `false` fallback revokes it',
    ).toBe(true);
    expect(
      DEFAULT_SETTINGS.allow_terminal,
      'the terminal IS the session on a headless host -- a `false` fallback ends it',
    ).toBe(true);
    expect(DEFAULT_SETTINGS.allow_keyboard_mouse).toBe(true);
    expect(DEFAULT_SETTINGS.allow_clipboard).toBe(true);
    expect(DEFAULT_SETTINGS.access_mode).toBe('full');
  });

  it('keeps the settings the agent also defaults off', () => {
    // Audio has no consumer in the agent, and these two have no implementation
    // at all; `true` here would claim capabilities that do not exist.
    expect(DEFAULT_SETTINGS.allow_audio).toBe(false);
    expect(DEFAULT_SETTINGS.allow_remote_restart).toBe(false);
    expect(DEFAULT_SETTINGS.block_user_input).toBe(false);
  });
});
