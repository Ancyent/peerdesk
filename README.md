# PeerDesk

Open-source remote desktop platform — alternative to RustDesk / AnyDesk.

**Browser-based viewer (no install) · P2P via WebRTC · Self-hostable · White-label support**

---

## Self-Host — Quick Start

**Requirement:** Docker installed. That's it.

```bash
git clone https://github.com/Ancyent/peerdesk
cd peerdesk/deploy
bash install.sh
```

The wizard asks 2-3 questions (domain, HTTPS?) and does the rest:
- builds the Docker images
- generates random secrets (DB, JWT, TURN)
- runs the database migrations
- starts all services
- prints the dashboard URL

**Dev local (hot reload):**
```bash
bash install.sh --dev
```

**Non-interactive (CI/scripting):**
```bash
# Prod with HTTPS
bash install.sh --domain peerdesk.example.com --tls --email admin@example.com

# Simple HTTP prod
bash install.sh --domain 192.168.1.10

# Without internal nginx (external proxy: Traefik/Caddy)
bash install.sh --no-nginx --domain 192.168.1.10
```

> Full guide, deployment modes and troubleshooting: **[docs/deploy-guide.md](docs/deploy-guide.md)**

---

## Download agent

Pre-built installers on [Releases page](https://github.com/Ancyent/peerdesk/releases).

| Platform | Package | Note |
|---|---|---|
| **Linux** | `.deb` (Debian/Ubuntu) | `sudo dpkg -i peerdesk_*.deb` |
| **Linux** | `.AppImage` | `chmod +x peerdesk_*.AppImage && ./peerdesk_*.AppImage` |
| **Windows** | `.msi` installer | Include WebView2 Runtime |
| **Windows** | `.exe` (NSIS) | Portable |
| **macOS** | `.dmg` (Universal) | Intel + Apple Silicon |
| **Android** | `.apk` | Enable "unknown sources" in Settings |
| **iOS** | — | Coming soon |

---

## Features

| Feature | Status |
|---|---|
| Browser viewer — no install required | ✅ |
| P2P connection via WebRTC | ✅ |
| TURN relay fallback (coturn) | ✅ |
| Screen capture + H.264 encoding | ✅ |
| Keyboard & mouse control | ✅ |
| Clipboard sync | ✅ |
| File transfer (drag & drop) | ✅ |
| Audio streaming | ✅ |
| Multi-monitor capture + runtime switching | ✅ |
| Quality presets + live stats overlay | ✅ |
| Remote cursor overlay | ✅ |
| Collapsible / draggable overlay controls (web) | ✅ |
| Attended connection approval (host prompt) | ✅ |
| User accounts + JWT auth | ✅ |
| 2FA / TOTP | ✅ |
| Machine registry + dashboard | ✅ |
| White-label branding | ✅ |
| Unattended access (systemd) | ✅ |
| Tauri native client (desktop viewer + host) | ✅ |
| Hardware-accelerated encoding | 📋 |
| Mobile viewer | 📋 |
| SSO / OIDC | 📋 |

---

## Architecture

```
Browser / Native Client
        │
        ▼
    nginx :80/:443
   ┌──────┴──────┐
   │             │
  /ws          /api/
   │             │
Signaling    API Server
(Python/     (Python/
 FastAPI/     FastAPI/
 Redis)       PostgreSQL)
        │
    WebRTC P2P ──── TURN relay (coturn)
        │
    Rust Agent
  (screen capture
   + input inject)
```

### Services

| Service | Technology | Port |
|---|---|---|
| nginx | nginx:alpine | 80, 443 (public) |
| web | React 19 + Vite → nginx | internal |
| api | Python 3.12 + FastAPI | internal |
| signaling | Python 3.12 + FastAPI + WebSockets | internal |
| postgres | PostgreSQL 16 | internal |
| redis | Redis 7 | internal |
| coturn | coturn/coturn | 3478 UDP/TCP (public) |

---

## Components

### Rust Agent (`agent/`)

Runs on the machine being controlled.

```bash
# Build
cargo build -p peerdesk-agent --release

# Run (standalone)
PEERDESK_PASSWORD=mypass SIGNALING_URL=wss://your-server/ws ./target/release/peerdesk-agent

# Run (with account registration)
PEERDESK_PASSWORD=mypass \
SIGNALING_URL=wss://your-server/ws \
API_URL=https://your-server/api \
API_TOKEN=<your-token> \
./target/release/peerdesk-agent
```

**Install as systemd service (unattended access):**

```bash
cargo build -p peerdesk-agent --release
sudo bash scripts/install-agent.sh ./target/release/peerdesk-agent
```

**Headless Linux server (agent only).** The agent auto-detects its environment.
With no graphical display it runs in **terminal mode** — a viewer connecting gets
an interactive shell (xterm) instead of a screen. The binary links the capture
libraries, so install them once even on a headless box:

```bash
sudo apt-get install -y libwayland-client0 libxcb1 libxcb-randr0 libpipewire-0.3-0 libgbm1 libegl1
```

Want a *graphical* desktop on a headless server instead? Start a virtual display
before the agent — it is then detected as GUI mode and captured:

```bash
Xvfb :99 -screen 0 1920x1080x24 &
DISPLAY=:99 fluxbox &
DISPLAY=:99 ./peerdesk-agent --server=... --api-key=...
```

### Signaling Server (`server/signaling/`)

WebSocket server that brokers WebRTC handshakes.

```bash
cd server/signaling
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
REDIS_URL=redis://localhost:6379 uvicorn main:app --port 8001
```

### API Server (`server/api/`)

REST API for accounts, machines, sessions, branding.

```bash
cd server/api
python3.12 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
DATABASE_URL=postgresql+asyncpg://... JWT_SECRET=... uvicorn main:app --port 8000
alembic upgrade head
```

### Browser Viewer (`web/`)

```bash
cd web
npm install
npm run dev          # dev server on :5173
npm run build        # production build → dist/
```

### Tauri Native Client (`desktop/`)

```bash
cd desktop
npm install
# Requires: libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev
cargo tauri dev      # needs DISPLAY (desktop environment)
cargo tauri build    # produces .deb / .AppImage
```

---

## Development

### Prerequisites

- Ubuntu 24.04+ (the agent's screen capture uses `xcap`, which needs pipewire ≥ 1.0 headers — 22.04 is too old)
- Rust 1.78+ (`rustup`)
- Node.js 20 (`nvm`)
- Python 3.12
- Docker + Docker Compose v2
- Agent build system deps (Linux):
  `libx11-dev libxcb1-dev libxcb-randr0-dev libxcb-shm0-dev libxtst-dev libxdo-dev libasound2-dev libssl-dev clang libwayland-dev libxkbcommon-dev libpipewire-0.3-dev libgbm-dev libegl1-mesa-dev`

### Dev stack — everything in Docker

```bash
cd deploy
bash install.sh --dev
# or directly:
docker compose -f docker-compose.dev.yml up -d --build
```

Migrations run automatically. Hot reload active for web and API.

### Local agent (for WebRTC testing)

```bash
# Virtual display (server without a monitor)
Xvfb :99 -screen 0 1280x720x24 &
DISPLAY=:99 fluxbox &

# Agent
DISPLAY=:99 PEERDESK_PASSWORD=test123 \
  SIGNALING_URL=ws://localhost:8001/ws \
  cargo run -p peerdesk-agent

# Open http://localhost:5173 → Register → Connect
```

---

## API Reference

Base URL: `https://your-server/api`

### Auth

| Method | Path | Description |
|---|---|---|
| `POST` | `/auth/register` | Create account |
| `POST` | `/auth/login` | Login (returns JWT or requires_2fa) |
| `POST` | `/auth/login/2fa` | Complete 2FA login |
| `POST` | `/auth/refresh` | Refresh access token |
| `POST` | `/auth/2fa/enable` | Generate TOTP secret |
| `POST` | `/auth/2fa/confirm` | Activate 2FA |
| `POST` | `/auth/2fa/disable` | Disable 2FA |

### Machines

| Method | Path | Description |
|---|---|---|
| `GET` | `/machines` | List your machines |
| `POST` | `/machines` | Register a machine |
| `GET` | `/machines/{id}` | Get machine details |
| `PATCH` | `/machines/{peer_id}/heartbeat` | Update online status |

### Sessions (audit log)

| Method | Path | Description |
|---|---|---|
| `POST` | `/sessions` | Start session record |
| `PATCH` | `/sessions/{id}/end` | End session record |

### TURN

| Method | Path | Description |
|---|---|---|
| `GET` | `/turn/credentials` | RFC 5766 TURN credentials |

### Branding

| Method | Path | Auth | Description |
|---|---|---|---|
| `GET` | `/branding` | — | Get current branding |
| `POST` | `/branding` | Required | Update branding |

### Users

| Method | Path | Description |
|---|---|---|
| `GET` | `/users/me` | Current user info |

---

## White-Label

PeerDesk supports runtime white-labeling without rebuilding the app.

1. Log in to the dashboard
2. Click **Branding** in the header
3. Upload your logo (PNG/SVG, max 512 KB)
4. Set your brand name and accent color
5. Click **Save** — changes apply instantly

The branding is served from `GET /api/branding` and loaded by every client on boot.

---

## Security

- **Passwords never sent plaintext** — viewers send bcrypt hash, signaling validates server-side
- **WebRTC DTLS** — all P2P and relay traffic is end-to-end encrypted
- **TURN credentials** — time-limited RFC 5766 HMAC-SHA1 per-session credentials
- **JWT tokens** — 15-min access tokens + 7-day refresh tokens
- **2FA / TOTP** — optional per-account (Google Authenticator, Authy, etc.)
- **Rate limiting** — 10 WebSocket connections/minute per IP on signaling server
- **Connection approval** — attended approval: the host gets an accept/reject prompt with a security code (CLI agent without a host UI auto-approves)
- **Config file** — stored with `0o600` permissions (Unix)

---

## Environment Variables

### Agent

| Variable | Default | Description |
|---|---|---|
| `PEERDESK_PASSWORD` | `changeme` | Password viewers must enter |
| `SIGNALING_URL` | `ws://localhost:8001/ws` | Signaling server WebSocket URL |
| `API_URL` | `http://localhost:8000` | API server URL |
| `API_TOKEN` | — | JWT token for machine registration |
| `DISPLAY_INDEX` | `0` | Which monitor to capture (0 = primary) |

### API Server

| Variable | Required | Description |
|---|---|---|
| `DATABASE_URL` | ✅ | PostgreSQL async URL |
| `JWT_SECRET` | ✅ | Secret for JWT signing (min 32 chars) |
| `TURN_SECRET` | — | Shared TURN secret (matches coturn) |
| `TURN_HOST` | `localhost` | TURN server hostname |
| `TURN_PORT` | `3478` | TURN server port |

### Signaling Server

| Variable | Default | Description |
|---|---|---|
| `REDIS_URL` | `redis://localhost:6379` | Redis connection URL |

---

## Running Tests

```bash
# Rust agent
cargo test -p peerdesk-agent --lib

# Python API
cd server/api && source .venv/bin/activate && pytest tests/ -v

# Python signaling
cd server/signaling && source .venv/bin/activate && pytest tests/ -v

# TypeScript
cd web && npx tsc --noEmit
```

---

## Building

### Prerequisites

- Rust 1.78+ — `rustup`
- Node.js 20 — `nvm`
- System deps (Linux): `libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev patchelf libxdo-dev libasound2-dev`

### Linux (.deb + .AppImage)

```bash
bash scripts/build-linux.sh
```

### Windows (.msi + .exe) — run on Windows

```powershell
.\scripts\build-windows-tauri.ps1
```

Or cross-compile the **agent only** from Linux:

```bash
bash scripts/build-windows-agent.sh
```

### macOS (.dmg Universal) — run on macOS

```bash
bash scripts/build-macos.sh
```

### Android (.apk)

```bash
# One-time setup (downloads Android SDK)
sudo bash scripts/setup-android.sh

# Initialize Android target (first time)
cd desktop && cargo tauri android init

# Build APK
bash scripts/build-android.sh
```

### Automated CI/CD

Push a tag to trigger builds for all platforms:

```bash
git tag v0.1.2
git push origin v0.1.2
```

GitHub Actions will build all platforms and create a draft release automatically.

---

## Roadmap

See [CHANGELOG.md](CHANGELOG.md) for what's shipped.

Planned:
- Hardware-accelerated encoding (NVENC / VAAPI / VideoToolbox)
- SSO / OIDC via oauth2-proxy
- Mobile viewer (React Native or Flutter)
- Session recording (MP4)
- SaaS billing (Stripe)
- Wake-on-LAN

---

## License

MIT

---

## Agent Deployment

### Quick install — Linux (as root)
```bash
curl -sSL https://raw.githubusercontent.com/Ancyent/peerdesk/main/scripts/deploy/install.sh \
  | sudo bash -s -- --server=https://your-server.com --api-key=YOUR_TOKEN
```

### Quick install — Windows (as Administrator)
```powershell
& ([scriptblock]::Create((irm https://raw.githubusercontent.com/Ancyent/peerdesk/main/scripts/deploy/install.ps1))) -Server "https://your-server.com" -ApiKey "YOUR_TOKEN"
```

### Manual / portable
```bash
# Get peer ID (creates config on first run):
./peerdesk-agent --server=https://your-server.com --api-key=YOUR_TOKEN --get-id

# Install as service (Linux):
sudo ./peerdesk-agent --install-service --server=https://your-server.com --api-key=YOUR_TOKEN

# Portable mode (config stored next to binary):
./peerdesk-agent --portable --server=https://your-server.com
```

### CLI reference

| Flag | Description |
|---|---|
| `--server=URL` | Base URL of PeerDesk server |
| `--api-key=TOKEN` | Registration token from dashboard (used once) |
| `--password=PW` | Override connection password |
| `--silent` | Log to file, no stdout (used by service) |
| `--portable` | Store config next to binary |
| `--get-id` | Print peer ID and exit |
| `--reset-password` | Generate new password, print, exit |
| `--install-service` | Install as systemd/Windows service |
| `--uninstall-service` | Remove service |
