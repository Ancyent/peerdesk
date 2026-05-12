# Changelog

All notable changes to PeerDesk are documented here.

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
