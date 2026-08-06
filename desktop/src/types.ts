export interface AgentStatus {
  running: boolean;
  peer_id: string;
  approval_status: 'pending' | 'approved' | 'denied' | 'standalone';
  server_url: string | null;
  access_mode: 'full' | 'view_only' | 'no_incoming';
  password: string | null;
}

export interface AppSettings {
  /// Schema stamp owned by the agent (`SETTINGS_VERSION` in agent/src/config.rs).
  /// The UI never sets it — `AppSettings::save` stamps every write — but it
  /// rides along on the object `get_settings` returns, so it is declared here
  /// rather than being silently dropped from the type.
  settings_version?: number;
  access_mode: 'full' | 'view_only' | 'no_incoming';
  show_approval_dialog: boolean;
  auto_disconnect_minutes: number | null;
  lock_screen_after_session: boolean;
  allow_keyboard_mouse: boolean;
  allow_clipboard: boolean;
  allow_file_transfer: boolean;
  allow_audio: boolean;
  allow_terminal: boolean;
  allow_remote_restart: boolean;
  block_user_input: boolean;
  image_quality: string;
  codec: string;
  view_mode: string;
  show_remote_cursor: boolean;
  hardware_acceleration: boolean;
  start_on_boot: boolean;
  minimize_to_tray: boolean;
  auto_update: boolean;
  language: string;
}

export const DEFAULT_SETTINGS: AppSettings = {
  access_mode: 'full',
  show_approval_dialog: true,
  auto_disconnect_minutes: null,
  lock_screen_after_session: false,
  allow_keyboard_mouse: true,
  allow_clipboard: true,
  // These two must mirror `AppSettings::default()` in agent/src/config.rs. They
  // are what the UI shows when `get_settings` fails, and the next toggle
  // persists the whole object -- so a stale `false` here silently revokes two
  // capabilities the host never turned off. `types.test.ts` pins them.
  allow_file_transfer: true,
  allow_audio: false,
  allow_terminal: true,
  allow_remote_restart: false,
  block_user_input: false,
  image_quality: 'balanced',
  codec: 'auto',
  view_mode: 'fit',
  show_remote_cursor: true,
  hardware_acceleration: true,
  start_on_boot: false,
  minimize_to_tray: true,
  auto_update: true,
  language: '',
};

export type SessionState = 'connecting' | 'negotiating' | 'connected' | 'error';

export interface Session {
  id: string;
  state: SessionState;
  error?: string;
}
