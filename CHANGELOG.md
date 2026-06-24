# Changelog

All notable changes to PeerDesk are documented here.

## [0.4.25] — 2026-06-24

### Added
- **Headless Linux terminal mode.** The agent auto-detects when there is no
  graphical display and serves an interactive shell (PTY) instead of a screen;
  the web viewer renders a terminal (xterm.js) automatically. A server with a
  virtual display (`Xvfb`) is still detected as GUI and captured.

## [0.4.24] — 2026-06-24

### Fixed
- **Fluid streaming on monitors driven by a second GPU.** The agent now uses
  Windows Graphics Capture (`xcap`'s `wgc` feature) for the video recorder
  instead of DXGI Desktop Duplication. DXGI duplication can't capture a monitor
  attached to a secondary GPU (hybrid graphics) — it failed with `E_INVALIDARG`
  and the agent fell back to slower screenshot capture. WGC captures any monitor
  regardless of GPU, so all displays now stream smoothly.

## [0.4.23] — 2026-06-24

### Fixed
- **Idle signaling connection kept alive.** The agent now pings the signaling
  server every 30s so a NAT/firewall idle timeout can't silently drop the
  connection — which previously left the host unable to show the approval prompt
  until the agent was restarted.
- The agent also publishes its monitor list on the WebRTC offer (not only on the
  legacy `viewer_joined` event), so the viewer reliably receives all displays in
  the attended-approval flow.

## [0.4.22] — 2026-06-23

### Fixed
- **Remote cursor overlay tracks the viewed monitor.** The host-cursor overlay
  was normalized against the primary monitor's size, so on multi-monitor hosts
  (or while viewing a secondary display) it stuck to an edge. It now normalizes
  against the captured monitor's bounds, like mouse input does.

### Added
- The agent logs the monitors `xcap` enumerates at startup/connect (count + each
  monitor's size, position, primary flag, name) — a diagnostic for multi-monitor
  detection issues. Visible on the standalone agent's console, or in
  `%LOCALAPPDATA%\peerdesk\agent.log` for the desktop app.

## [0.4.21] — 2026-06-23

### Fixed
- **Multi-monitor detection on Windows.** Replaced the `scrap` capture engine
  with `xcap` (Windows Graphics Capture). Hosts with multiple GPUs (e.g. Intel
  iGPU + discrete GPU) now report and capture **all** monitors instead of only
  the primary, so the viewer's monitor picker appears and switching works.
- Input now targets the captured monitor via the same `xcap` index used for
  capture, removing the capture/input index-mismatch risk.

### Changed
- Monitor picker redesigned as an icon strip: numbered monitor glyphs, the
  primary highlighted amber with a **D** (Default) badge, the selected one
  highlighted light green. Applies to both the web and desktop viewers.

## [0.4.20] — 2026-06-23

### Fixed
- **Clicks land on the correct monitor — including secondary displays.** Mouse
  input was always mapped to the host's primary monitor, so clicking while
  viewing a second screen landed on the wrong place. On Windows the agent now
  injects absolute mouse moves over the whole virtual desktop and maps to the
  currently viewed display's bounds (resolved via `display-info`).

## [0.4.19] — 2026-06-23

### Added
- **Switch host displays from the desktop client.** The desktop viewer now has
  the monitor picker the web viewer already had — pick which of the host's
  screens to view.
- **Hide the remote cursor.** A "🖱 Cursor" button in the viewer toolbar (web +
  desktop) shows/hides the remote cursor locally, and a host setting ("Show my
  cursor to the viewer") stops the host from sending it at all.

### Note
- Correct mouse input on a **secondary** monitor is still pending (needs
  Windows-specific work); switching displays for *viewing* works now.

## [0.4.18] — 2026-06-23

### Fixed
- **Reconnecting now works without restarting the host agent.** The agent reused
  a single WebRTC peer connection for its whole lifetime, so a second viewer
  (e.g. after a browser refresh) landed on a stale connection that couldn't
  renegotiate — no video until the agent was restarted. The agent now builds a
  fresh peer connection per viewer session.
- **Quality dropdown shows over the video.** The "⚙ Quality" menu was being
  painted behind the video; the toolbar now stacks above it.
- **Activity log** (desktop Network settings) no longer yanks you back to the
  newest line while you've scrolled up to read older entries.

## [0.4.17] — 2026-06-22

### Added
- **Remote cursor.** The viewer now shows where the host's cursor is — a small
  arrow drawn over the video, tracking the real host pointer (including the
  host's own movements). The screen capture doesn't include the hardware cursor,
  so the agent sends the cursor position over a new data channel.

### Fixed
- **Clicks land correctly on downscaled streams.** Mouse coordinates are now
  normalized (0..1) and mapped to the host's native resolution, so picking a
  lower-resolution quality preset no longer mis-places clicks.
- **Quality & Stats moved into the toolbar.** The quality preset (now a "⚙
  Quality" dropdown) and the Stats toggle live in the top toolbar instead of
  floating over the screen.

## [0.4.16] — 2026-06-22

### Added
- **Quality presets + stats overlay in the viewer** (web and desktop). Pick an
  image-quality preset — Good / Balanced / Optimize reaction time — or Custom
  (set your own FPS + bitrate). The viewer sends the target bitrate, fps, and a
  resolution cap to the host over a new `control` data channel; the host caps
  its capture frame rate, downscales the screen, and re-encodes at the chosen
  bitrate — so a session stays usable on a poor connection (smaller resolution
  and traffic). A **Stats** toggle shows live FPS, throughput, delay (RTT),
  resolution, codec, target bitrate, and packet loss.

## [0.4.15] — 2026-06-22

### Fixed
- **Agent stopped with "invalid turn server credentials".** The agent built its
  TURN ICE server with the default credential type, but webrtc-rs requires
  `Password` for TURN and rejected it (`ErrTurnCredentials`) — so the agent
  stopped on startup whenever the server returned TURN config (i.e. always).
  Now sets `credential_type: Password`.
- **Approval prompt never appeared (viewer stuck on "connecting").** If the
  agent's signaling socket was stale (e.g. just after a client upgrade), the
  server raised an unhandled error while sending the approval request to it,
  which killed the viewer's connection so the prompt never reached the host. It
  now handles a dead agent socket gracefully (drops it and denies cleanly).

## [0.4.14] — 2026-06-22

### Fixed
- **Android build.** The desktop-viewer TURN command added in v0.4.13 didn't
  compile for Android (which doesn't link the agent crate), failing the `.apk`
  job. It's now stubbed on Android — that viewer falls back to public STUN until
  it has its own server config. Re-cut so the Windows agent (a transient
  toolchain-download failure in v0.4.13) is rebuilt too.

## [0.4.13] — 2026-06-22

### Fixed
- **Desktop & Android viewer now use the TURN relay too.** v0.4.12 wired TURN
  into the web viewer and the agent, but the desktop/Android viewer client kept
  its own STUN-only config and still showed a black screen across networks. It
  now fetches TURN credentials from the server (via the Tauri backend, using the
  agent's API key) and adds the relay to its ICE servers, matching the web
  viewer. All three clients — web, desktop, agent — now traverse NAT.

## [0.4.12] — 2026-06-22

### Fixed
- **Black screen after connecting across networks.** When the viewer and the
  host were on different networks/subnets, the connection established but no
  video flowed (black screen) because only STUN was configured — there was no
  working relay for NAT traversal. The bundled TURN server (coturn) was also
  crash-looping on an invalid option (`--no-loopback-peers`) and was never
  referenced by the clients.

### Added
- **TURN relay is now used end to end.** The server hands out time-limited TURN
  credentials (`GET /turn/credentials` for the dashboard, `GET
  /turn/agent-credentials` for the agent), and both the web viewer and the agent
  request them and add the relay to their ICE servers. Same-LAN peers still
  connect directly (host candidates); cross-network peers fall back to the
  relay. Configure with `TURN_SECRET` + `TURN_HOST` in `deploy/.env`.

## [0.4.11] — 2026-06-17

### Added
- **Version badge + update check** in the desktop client (bottom-right): shows
  the current version and, when a newer GitHub release exists, an "Update
  available" button linking to the download.
- CI injects the release tag into the app version so it's always accurate.

## [0.4.10] — 2026-06-17

### Fixed
- **Connected but no video.** Restarting the agent (Apply/reset) left the old
  signaling/heartbeat tasks running as orphans; with auto-reconnect they
  persisted and a second peer connection raced the new one, so DTLS failed
  (`remote certificate does not match any fingerprint`) and no media flowed.
  The agent now aborts its background tasks when it restarts.

## [0.4.9] — 2026-06-16

### Added
- **Activity log** in the desktop Network settings — a live view of the agent's
  connect/register/error/reconnect events so you can see what's happening.

### Fixed
- **Agent auto-reconnects to signaling.** A single disconnect (network blip,
  server restart) used to silently de-register the agent until the app was
  restarted; it now reconnects with backoff and re-registers.
- **"Apply & Reconnect" actually reconnects.** Setting the server URL + API key
  saved the config but never restarted the agent, so on a fresh setup the
  machine never appeared in the dashboard. It now restarts and registers.
- **Online status** is computed from the last heartbeat (offline after ~90s), so
  a stopped machine no longer shows online forever.
- **Delete a machine** from the dashboard (DELETE /machines/{id} + UI button).

## [0.4.8] — 2026-06-16

### Fixed
- **Approval prompt now appears.** The agent correctly waited for the host's
  decision, but the Tauri event that should have shown the Accept/Reject dialog
  never reached the webview on Windows, so connections timed out and were denied
  after 60s. The dialog now polls `get_pending_approval` (event kept as a fast
  path), so the prompt reliably shows.
- **Signaling rate limiting behind nginx.** The rate limiter keyed on the proxy
  IP, so all clients shared one bucket and the agent got rejected (`machine not
  found`); it now uses the real client IP from `X-Forwarded-For`/`X-Real-IP`.
- **Web:** signaling messages sent before the socket opens are queued, not
  dropped.

## [0.4.7] — 2026-06-16

### Fixed
- **Password reset now takes effect.** Resetting the access password changed
  `config.json` but the running agent stayed registered with the signaling
  server under the old HMAC key, so connecting from the web with the new
  password failed (`auth_failed`) and the approval prompt never appeared. The
  agent now restarts on reset and re-registers with the new password.

## [0.4.6] — 2026-06-16

### Changed
- **Readability:** text and icons are considerably brighter across both the web
  dashboard and the desktop client (lifted muted secondary/tertiary colors on
  the dark theme).

## [0.4.5] — 2026-06-16

### Added
- **Attended access:** the host now gets an Accept/Reject prompt for every
  incoming connection (60s auto-reject), regardless of password. Bridged from
  the agent to the desktop UI via a Tauri event + `respond_approval` command.
- **Visible access password:** the desktop shows the host's own access password
  (reveal toggle + copy). It is stored 0600 next to `config.json`; legacy
  installs prompt to reset to set a visible one.

### Changed
- **Passwords are now simple:** 8 characters, lowercase letters + digits only,
  no special or ambiguous characters (was a 12-char alphanumeric).

## [0.4.4] — 2026-06-15

### Fixed
- **Agent:** a registered machine now actually shows **online**. `send_heartbeat`
  was never called, so the machine stayed `is_online=false` (shown offline even
  after approval); the agent now sends a heartbeat immediately and every 30s.
- **Agent:** Windows machines are named from `COMPUTERNAME` instead of `Unknown`.
- **Desktop:** removed the **white border** around the window — it was the
  browser default `body` margin; added a global + inline critical CSS reset
  (`margin:0`, dark background, `html/body/#root` at `height:100%`) and themed
  dark scrollbars, which also removes the stray scrollbar.

## [0.4.3] — 2026-06-15

### Fixed
- **Agent:** machine registration now reaches the server. The agent derived the
  REST API base without the `/api` prefix, so `POST /machines/register` hit the
  web SPA and returned 405 — machines never appeared in the dashboard. The agent
  now derives `<server>/api` (matching the same nginx that serves `/ws`).
- **Web:** the Downloads page reads the latest GitHub release dynamically (version
  + asset links) instead of a hardcoded `v0.3.9`, so it never goes stale.

### Changed
- **Desktop:** custom frameless title bar in the PeerDesk dark theme with working
  minimize/maximize/close controls, replacing the native OS title bar; copy/reset
  icons are now prominent accent-tinted chips.
- **Docs:** added `docs/RUNBOOK.md` (architecture, server bring-up, host
  registration flow, release process).

## [0.4.2] — 2026-06-15

Comprehensive bug-fix pass across all components (agent, servers, web, desktop).

### Security
- **Agent:** fixed path traversal in file transfer — a viewer-supplied filename could escape the download directory and write arbitrary files; names are now reduced to a basename and validated against the download dir
- **API:** fixed 2FA bypass — the login `temp_token` was a fully valid access token; replaced with a dedicated short-lived `pending_2fa` token rejected by protected endpoints
- **Signaling:** fixed `peer_id` hijack — a registration could overwrite a live agent's entry; re-registration now requires a matching HMAC key
- **API:** `set_placement` validates company/location/group ownership; registration-token redemption uses `SELECT ... FOR UPDATE` to prevent double-redemption
- **Agent:** an HTTP 409 approval re-check failure now defaults to `pending` (not `approved`)

### Fixed
- **Agent:** H.264 encoder resets on resolution change so video survives a display switch; `start_agent` no longer overwrites the saved HMAC key with an empty password; `stop_agent` actually aborts the running task; removed a silently-failing audio thread
- **Signaling:** rate limiter now accepts the socket before closing it (the limit was a no-op); a viewer disconnecting during approval can no longer crash the agent's connection; the real viewer IP is passed to the approval notification
- **Web:** Ctrl+Alt+Del sends the full key sequence; file-transfer bar opens on demand instead of covering the remote video and the toolbar button works; OrgTree honors the dark theme; ConnectForm syncs when switching machines; branding logo removal no longer renders a broken image
- **Desktop:** removed hardcoded fake "Recent" machines (now a real localStorage list); shared agent/settings state via context (fixes stale settings and redundant polling); `denied` approval status is shown distinctly in red; deleted dead code; real app version; settings polish

## [0.1.2] — 2026-05-12

Native desktop clients for Linux, Windows, macOS, and Android.

### Added

#### Tauri Desktop App (`desktop/`)
- **Host Mode** — system tray app that starts the PeerDesk agent, displays peer ID with copy button, shows/hides password; polls agent status every 5 seconds; persists signaling server URL in localStorage
- **Viewer Mode** — connect form (peer ID + password + signaling URL) → full-screen video viewer with Disconnect/Back overlay buttons; reuses `useSignaling` + `useWebRTC` hooks from the web app
- **Mode selector** — launch screen with "Host This PC" and "Connect to PC" buttons
- `useTauriAgent` hook — wraps Tauri `invoke` calls for `start_agent`, `stop_agent`, `get_agent_status`
- Tauri commands: `start_agent` (launches agent library, returns peer_id), `stop_agent`, `get_agent_status`
- Shared state `Arc<Mutex<AgentState>>` for thread-safe agent lifecycle management

#### Build Scripts (`scripts/`)
- `build-linux.sh` — builds `.deb` + `.AppImage` via `cargo tauri build`
- `build-windows-agent.sh` — cross-compiles agent `.exe` from Linux via mingw-w64
- `build-windows-tauri.ps1` — full Tauri `.msi`/`.exe` build on Windows (PowerShell)
- `build-macos.sh` — Universal binary `.dmg` (Intel + Apple Silicon) on macOS
- `build-android.sh` — builds `.apk` via `cargo tauri android build`
- `setup-android.sh` — one-time Android SDK + NDK setup (OpenJDK 17, SDK 34, NDK 26)

#### GitHub Actions (`.github/workflows/build-clients.yml`)
- Matrix build triggered on `v*` tags or manual dispatch
- Jobs: `build-linux` (ubuntu-22.04), `build-windows` (windows-latest), `build-macos` (macos-latest), `build-android` (ubuntu-22.04 + Android NDK)
- `release` job creates a draft GitHub Release with all artifacts on tag push

## [0.1.1] — 2026-05-12

White-label branding — customize logo, product name, and accent color from the admin dashboard.

### Added

#### Branding API (`server/api/`)
- `Branding` SQLAlchemy model (singleton row, id=1): `brand_name`, `logo_data_url` (Text, base64 data URL), `accent_color` (hex), `updated_at`
- Alembic migration `0004_branding`
- `GET /branding` — public endpoint, returns current branding config (defaults: PeerDesk / #2563eb)
- `POST /branding` — authenticated, updates branding fields with hex color validation
- `BrandingOut` and `BrandingUpdate` Pydantic schemas

#### Web Theming (`web/`)
- `web/src/branding.css` — CSS custom properties: `--accent`, `--accent-hover` (defaults to #2563eb / #1d4ed8)
- `web/src/hooks/useBranding.ts` — fetches `/branding` on mount, applies CSS vars to `:root` via `document.documentElement.style.setProperty`, updates `document.title` with brand name
- `applyBranding()` utility — accepts `BrandingConfig`, applies `--accent` + `--accent-hover` (auto-darkened) + page title
- All hardcoded `#2563eb` accent colors replaced with `var(--accent)` across ConnectForm, FileTransferBar, LoginPage, RegisterPage, DashboardPage
- `api.branding` added to API client (get + update)

#### Web Admin (`web/`)
- `BrandingPage` — admin page accessible from the dashboard header:
  - Logo upload: accepts any image, max 512 KB, stored as base64 data URL
  - Brand name text input (max 100 chars)
  - Accent color picker: native `<input type="color">` + hex text field
  - Live preview panel showing logo/name + Connect button in selected color
  - Save button applies changes immediately via `applyBranding()`
  - Reset to Default button restores PeerDesk defaults
- `DashboardPage` — "Branding" button added to header
- `App.tsx` — new `'branding'` route

#### Web Branding Context (`web/`)
- `BrandingContext` React context — provides `BrandingConfig` (brand_name, logo_data_url, accent_color) to all components
- `BrandingProvider` — wraps the entire app in `main.tsx`, loads branding on boot
- `ConnectForm`, `LoginPage`, `RegisterPage` — show `<img>` logo when `logo_data_url` is set, otherwise `<h1>{brand_name}</h1>`

## [0.1.0-Beta] — 2026-05-12

First feature-complete beta release. All post-MVP features implemented.

### Added

#### File Transfer
- **Agent** (`agent/src/file_transfer/mod.rs`) — receives files via WebRTC `"filetransfer"` data channel; JSON control protocol (`ft_offer`/`ft_accept`/`ft_reject`/`ft_cancel`/`ft_done`); binary chunks reassembled and saved to `~/Downloads/` (or `/tmp/peerdesk-transfers/`); 1 GB size limit; progress events every ~1 MB
- **Browser** (`web/src/hooks/useFileTransfer.ts`) — sends files in 64 KB chunks with back-pressure; offer/accept handshake with 15s timeout; progress state tracking
- **Browser** (`web/src/components/FileTransferBar.tsx`) — fixed bottom bar with "Send File" button, filename, progress bar (%), done/error status

#### Audio Streaming
- **Agent** (`agent/src/audio/mod.rs`) — captures from default audio input device using `cpal` crate; f32→i16 PCM conversion; runs on dedicated OS thread (cpal is `!Send`); gracefully skips if no audio device available
- **Browser** (`web/src/components/Viewer.tsx`) — hidden `<audio>` element receives stream; mute/unmute toggle button overlay (`🔇`/`🔊`)

#### Multi-Monitor Support
- **Agent** — `capture::list_displays()` enumerates all displays via `scrap::Display::all()`; `capture::run()` accepts `display_index` parameter; sends `display_list` message to viewer on `ViewerJoined`; handles `switch_display` message (index switch logged, restart is a TODO)
- **Agent** (`agent/src/signaling/mod.rs`) — new `SignalingMessage` variants: `SwitchDisplay { index }`, `DisplayList { displays }`
- **Agent** — `AgentConfig` gains `display_index: usize` (env `DISPLAY_INDEX`, default 0)
- **Browser** (`web/src/components/DisplaySelector.tsx`) — dropdown overlay showing all monitors with resolution; hidden when only one monitor available; primary monitor marked with ★
- **Browser** (`web/src/App.tsx`) — sends `switch_display` on selection change; receives `display_list` on connect

#### 2FA TOTP
- **API** (`server/api/routers/totp.py`) — `POST /auth/2fa/enable` (generates TOTP secret + QR URI for authenticator apps), `POST /auth/2fa/confirm` (validates first code to activate), `POST /auth/2fa/disable` (validates code to deactivate)
- **API** — login flow updated: `POST /auth/login` returns `requires_2fa: true` + `temp_token` when 2FA is enabled; `POST /auth/login/2fa` validates TOTP code + temp token and returns full JWT tokens
- **API** — `User` model gains `totp_secret: str | None` and `totp_enabled: bool`; Alembic migration `0003_totp`
- `pyotp==2.9.0` added to requirements

#### Unattended Access
- `deploy/systemd/peerdesk-agent.service` — systemd unit template: `After=network-online.target`, `EnvironmentFile=/etc/peerdesk-agent.env`, `Restart=always`, security hardening (`NoNewPrivileges`, `PrivateTmp`, `ProtectSystem=strict`)
- `scripts/install-agent.sh` — interactive installer: prompts server URL + agent password + API token; creates `peerdesk` system user; installs binary to `/usr/local/bin`; writes `/etc/peerdesk-agent.env` (mode 600); deploys and starts systemd service; extracts peer_id from journal

### Planned (post-Beta)
- **White-label client** — generate custom-branded client (logo + accent color) from the admin dashboard; CSS variable theming at runtime; branded Tauri package download
- **Hardware-accelerated encoding** — NVENC (NVIDIA), VAAPI (Linux), VideoToolbox (macOS)
- **SSO / OIDC** — oauth2-proxy in front of API
- **Mobile viewer** — React Native or Flutter
- **Session recording** — server-side or client-side MP4
- **SaaS billing** — Stripe integration, per-seat pricing
- **Wake-on-LAN** support

## [0.0.5-Alpha] — 2026-05-12

Phase 5: coturn TURN relay, TURN credentials API, signaling rate limiting, connection approval flow, and session audit logging.

### Added

#### TURN Relay (`deploy/`)
- `coturn/coturn:latest` Docker service added to both `docker-compose.dev.yml` and `docker-compose.yml`
- Service runs with `network_mode: host` for proper ICE relay candidate binding
- `--use-auth-secret` mode: no static passwords, only RFC 5766 time-limited credentials
- `deploy/coturn/turnserver.conf` — base configuration (realm, port range 49152-65535, no loopback/multicast peers)
- `TURN_SECRET` added to `.env.example` and auto-generated in `install.sh`

#### TURN Credentials API (`server/api/`)
- `GET /turn/credentials` — RFC 5766 HMAC-SHA1 time-limited TURN credentials
  - `username = "<expiry_unix_ts>:<user_id>"`, `password = base64(HMAC-SHA1(secret, username))`
  - Credentials expire after 3600 seconds (configurable via env)
  - Returns `urls`, `username`, `credential`, `ttl`
- Reads `TURN_SECRET`, `TURN_HOST`, `TURN_PORT` from environment

#### Signaling Security (`server/signaling/`)
- Per-IP rate limiting: max 10 WebSocket connections per 60-second window
- Excess connections rejected with WebSocket close code 1008 (`rate limited`)
- In-memory `defaultdict(list)` tracking connection timestamps per IP
- Old entries automatically pruned from the window on each check

#### Connection Approval Flow
- **Signaling server** — new `viewer_pending` state in `ConnectionState`; `handle_join` now queues the viewer and sends `viewer_pending` to the agent instead of immediately joining; `request_approval()` / `handle_approval()` functions; handles `approve`/`deny` messages from agent
- **Agent** (`signaling/mod.rs`) — new `SignalingMessage` variants: `ViewerPending`, `Approve`, `Deny`, `Denied`
- **Agent** (`lib.rs`) — handles `ViewerPending` with **auto-approve** (sends `Approve` back immediately); UI-driven approval is post-MVP
- **Browser viewer** — `SignalingMessage` union extended with `viewer_pending`, `approved`, `denied` types; `denied` message shows reason in error state and returns to connect form

#### Session Audit Log (`server/api/`)
- `Session` SQLAlchemy model: `id`, `host_peer_id`, `viewer_user_id` (FK → users, SET NULL on delete), `started_at`, `ended_at`, `connection_type` (p2p|relay), `bytes_transferred`
- Alembic migration `0002_sessions` creating the sessions table
- `POST /sessions` — create session record (no auth, called by signaling)
- `PATCH /sessions/{id}/end` — stamp `ended_at` on session end (no auth)

## [0.0.4-Alpha] — 2026-05-12

Phase 4: clipboard sync + Tauri v2 native desktop client scaffold.

### Added

#### Clipboard Sync
- **Agent** (`agent/src/clipboard/mod.rs`) — bidirectional clipboard sync using `arboard` crate; clipboard polling runs on a dedicated OS thread (arboard is blocking/`!Send`), polls every 500ms for local changes, writes incoming viewer clipboard to system clipboard
- **Agent WebRTC** — `PeerConnection` now handles `"clipboard"` data channel alongside `"input"`; exposes `clipboard_in_rx` and `clipboard_out_tx` for wiring
- **Browser viewer** (`web/src/hooks/useClipboard.ts`) — listens for `copy`/`cut` document events, reads via `navigator.clipboard.readText()`, sends to agent; receives agent clipboard via `receiveFromAgent()` and writes via `navigator.clipboard.writeText()`
- **Browser viewer** (`web/src/hooks/useWebRTC.ts`) — creates `"clipboard"` RTCDataChannel in `startOffer`; exposes `sendClipboard()` and accepts `onClipboardFromAgent` callback; clipboard sync is only active while a WebRTC session is live

#### Rust Agent Library Refactor
- Added `[lib]` target to `agent/Cargo.toml` — crate now builds as both binary and library (`peerdesk_agent`)
- `agent/src/lib.rs` — public API: `AgentConfig` struct (password, signaling_url, api_url, api_token) with `Default` reading from env vars; `run_agent(AgentConfig) -> Result<()>` containing the full agent logic
- `agent/src/main.rs` — now a 5-line thin wrapper calling `run_agent(AgentConfig::default())`
- All submodules re-exported as `pub mod` for Tauri embedding

#### Tauri v2 Native Client (`desktop/`)
- `desktop/src-tauri/` — Tauri v2 Rust backend: system tray with Show/Quit menu items, left-click tray to show window, Tauri commands `get_agent_info` and `open_viewer`
- `desktop/src-tauri/Cargo.toml` — imports `peerdesk-agent` as a path dependency
- `desktop/src-tauri/tauri.conf.json` — window config (1000×700), tray icon, SPA frontend
- `desktop/src-tauri/capabilities/default.json` — default capability set
- `desktop/src/main.tsx` — React frontend with Host Mode / View Mode panels
- `cargo check` passes — Tauri scaffold builds successfully (runtime requires desktop environment)

## [0.0.3-Alpha] — 2026-05-12

Phase 3: production deployment stack and self-hosted installer.

### Added

#### Web (`web/`)
- Multi-stage production Dockerfile: `node:20-alpine` builds React app → `nginx:alpine` serves `dist/`
- `web/nginx.conf` — SPA routing (`try_files` fallback to `index.html`), gzip, immutable cache headers for assets
- Build accepts `VITE_SIGNALING_URL` and `VITE_API_URL` as Docker build args (baked at build time)

#### Infrastructure (`deploy/`)
- `deploy/docker-compose.yml` — production stack: all 6 services (postgres, redis, api, signaling, web, nginx) on isolated `internal` bridge network; only nginx exposes ports 80/443
- `deploy/nginx/default.conf` — HTTP reverse proxy: `/ws` (WebSocket with 3600s timeout), `/api/` (REST with prefix rewrite), `/` (React SPA)
- `deploy/.env.example` — documented environment variable template with generation hints
- `deploy/install.sh` — interactive one-command self-hosted installer:
  - Auto-detects and installs Docker if missing (Ubuntu/Debian/CentOS/RHEL)
  - Prompts for domain/IP and optional HTTPS
  - Generates `.env` with `openssl rand` random secrets
  - Optionally provisions TLS via Let's Encrypt (certbot standalone)
  - Builds and starts the full Docker Compose stack
  - Runs Alembic database migrations
  - Prints dashboard URL and agent setup instructions

## [0.0.2-Alpha] — 2026-05-12

Phase 2: user accounts, machine registry, and web dashboard.

### Added

#### Auth & API Server (`server/api/`)
- FastAPI async REST API server on port 8000
- PostgreSQL 16 database via SQLAlchemy 2.x async + asyncpg
- Alembic async migrations — `users` and `machines` tables
- `POST /auth/register` — create account, returns JWT access + refresh tokens
- `POST /auth/login` — email + password login
- `POST /auth/refresh` — exchange refresh token for new access token (7-day refresh, 15-min access)
- `GET /users/me` — return current authenticated user
- `GET /machines` — list machines owned by current user
- `POST /machines` — register a new machine (peer_id + name + os)
- `GET /machines/{id}` — get machine by ID
- `PATCH /machines/{peer_id}/heartbeat` — agent updates online status (no auth required)
- CORS enabled for all origins (dev mode)
- 15 integration tests using SQLite in-memory (pytest-asyncio)

#### Browser Dashboard (`web/`)
- `LoginPage` — email + password sign-in with error handling
- `RegisterPage` — name + email + password registration (min 8 char password)
- `DashboardPage` — machine list with online/offline status indicators, connect button (disabled when offline)
- `AuthContext` — React context with login/register/logout, localStorage token persistence, on-mount token validation
- `useAuth` hook — typed access to auth context
- `api/client.ts` — typed fetch wrapper for all API endpoints
- App routing updated: `loading → login/register → dashboard → connect → viewer`
- `ConnectForm` updated to accept `initialPeerId` prop (pre-filled from dashboard)

#### Rust Agent (`agent/`)
- Optional API registration on startup: if `API_TOKEN` env var is set, agent POSTs to `API_URL/machines` with its peer_id, name, and OS
- `send_heartbeat()` function for future online status updates
- API registration is non-fatal — agent works in standalone mode without `API_TOKEN`

#### Infrastructure (`deploy/`)
- `docker-compose.dev.yml` updated: added `postgres:16-alpine` (with healthcheck) and `api` service
- Named volume `postgres_data` for persistent DB storage

### Technical Stack additions

| Component | Technology |
|---|---|
| API server | Python 3.12, FastAPI 0.115, SQLAlchemy 2.0, asyncpg, Alembic 1.14 |
| Auth | python-jose (JWT), passlib[bcrypt] |
| Validation | Pydantic 2.10 |
| Database | PostgreSQL 16-alpine |
| Agent HTTP | reqwest 0.12 (rustls-tls) |

---

## [0.0.1-Alpha] — 2026-05-12

Initial alpha release implementing the core P2P remote desktop loop.

### Added

#### Signaling Server (`server/signaling/`)
- FastAPI + WebSocket signaling server that brokers WebRTC handshakes between host agents and browser viewers
- `ConnectionState` in-memory session registry (agent connections, viewer connections, bidirectional cross-refs)
- `register_agent` — registers a host agent with bcrypt password hash in Redis (TTL 3600s)
- `unregister_agent` — removes agent, notifies connected viewer with `agent_disconnected` event, cleans up cross-refs
- `handle_join` — validates viewer password against stored bcrypt hash, creates viewer session, notifies agent
- `forward_to_peer` — routes SDP offer/answer and ICE candidates between agent and viewer WebSocket connections
- `GET /health` — health check endpoint
- `WebSocket /ws` — single endpoint handling `register`, `join`, `offer`, `answer`, `ice_candidate` message types
- Graceful JSON parse error handling (responds with `{"type":"error","code":"invalid_json"}` and continues)
- Graceful missing-field handling (`{"type":"error","code":"missing_field:<key>"}`)
- Redis client null guard at WebSocket startup
- Viewer disconnect cleanup using O(1) `viewer_to_agent` reverse lookup

#### Rust Agent (`agent/`)
- `config` module — 9-digit numeric peer ID generation, bcrypt password hashing, JSON config file load/save with 0o600 permissions (Unix), TOCTOU-safe load-or-create
- `capture` module — screen capture loop using `scrap` crate (X11/Wayland), sends raw BGRA frames via Tokio channel, WouldBlock retry with 16ms sleep
- `encode` module — H.264 encoding via `openh264` (BgraSliceU8 → YUV420 → H.264 Annex B), validates buffer length and even dimensions before encoding
- `input` module — keyboard/mouse/scroll injection via `enigo` crate, full web key name mapping (Enter, Escape, Backspace, Tab, Space, Delete, Home, End, PageUp, PageDown, arrows, modifiers), left/right/middle mouse button support, horizontal scroll, unknown keys are no-op
- `signaling` module — WebSocket client using `tokio-tungstenite`, sends `register` on connect, select! loop forwarding messages bidirectionally, handles WS close/non-text frames gracefully, logs unknown message types instead of crashing
- `webrtc_peer` module — RTCPeerConnection with Google STUN, H.264 video track (TrackLocalStaticSample), input data channel handler, ICE candidate forwarding, SDP offer/answer handling, graceful H264Encoder init failure
- `main` binary — wires all modules, capture runs on dedicated OS thread (scrap is `!Send`), event loop handles ViewerJoined/Offer/IceCandidate/Error messages cleanly

#### Browser Viewer (`web/`)
- `SignalingMessage` TypeScript discriminated union for all signaling protocol messages
- `useSignaling` hook — stable WebSocket connection with ref-stabilized callback, auto-close on unmount
- `useWebRTC` hook — RTCPeerConnection lifecycle management, `startOffer` (creates PC + data channel + sends offer), `handleAnswer`, `handleIceCandidate`, `sendInput`, `disconnect`, closes stale PC before reconnecting, awaits `setLocalDescription` before sending offer
- `ConnectForm` component — 9-digit numeric ID field (digits-only filter), password field, disabled submit until 9 digits entered
- `Viewer` component — `<video>` element with transparent overlay, cursor:none, auto-focus on mouse enter for keyboard capture, scaled mouse coordinates (maps overlay pixels to video resolution), all mouse buttons forwarded, scroll (both axes), prevents browser context menu and default key actions
- `App` state machine — `idle → connecting → connected → error` transitions, handles `joined/answer/ice_candidate/error/agent_disconnected` signaling messages, error cleared on reconnect

#### Infrastructure (`deploy/`, `server/signaling/`)
- `server/signaling/Dockerfile` — python:3.12-slim image
- `deploy/docker-compose.dev.yml` — Redis 7 (with healthcheck) + signaling server (hot-reload via uvicorn --reload, volume mount)

### Technical Stack

| Component | Technology |
|---|---|
| Signaling server | Python 3.12, FastAPI 0.115, uvicorn, redis.asyncio, passlib[bcrypt] |
| Rust agent | Rust 1.95, tokio 1, scrap 0.5, openh264 0.6, webrtc 0.11, enigo 0.2, tokio-tungstenite 0.23 |
| Browser viewer | TypeScript 5, React 19, Vite 6 |
| Infrastructure | Docker Compose, Redis 7 |

### Known Limitations (Post-Alpha)

- No user accounts or machine registry (Phase 2)
- No TURN relay fallback — P2P only, may fail through strict NATs (Phase 5)
- No clipboard sync (Phase 4)
- No native desktop client (Phase 4)
- No TLS / production deployment (Phase 3)
- No file transfer, audio, or session recording (post-MVP)
