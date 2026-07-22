export interface AgentStatus {
  running: boolean;
  peer_id: string;
  approval_status: 'pending' | 'approved' | 'denied' | 'standalone';
  server_url: string | null;
  access_mode: 'full' | 'view_only' | 'no_incoming';
  password: string | null;
}

export interface AppSettings {
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
  allow_file_transfer: false,
  allow_audio: false,
  allow_terminal: false,
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
