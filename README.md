# PeerDesk

Open-source remote desktop platform — alternative to RustDesk / AnyDesk.

**Browser-based viewer (no install) · P2P via WebRTC · Self-hostable in one command · White-label support**

---

## Download

Pre-built installers are available on the [Releases page](https://github.com/Ancyent/peerdesk/releases).

| Platform | Package | Notes |
|---|---|---|
| **Linux** | `.deb` (Debian/Ubuntu) | `sudo dpkg -i peerdesk_*.deb` |
| **Linux** | `.AppImage` | `chmod +x peerdesk_*.AppImage && ./peerdesk_*.AppImage` |
| **Windows** | `.msi` installer | Requires WebView2 Runtime (included) |
| **Windows** | `.exe` (NSIS) | Portable installer |
| **macOS** | `.dmg` (Universal) | Intel + Apple Silicon |
| **Android** | `.apk` | Enable "Install from unknown sources" in Settings |
| **iOS** | — | Coming soon |

> **Build from source:** See [Building](#building) section below.

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
| Multi-monitor support | ✅ |
| User accounts + JWT auth | ✅ |
| 2FA / TOTP | ✅ |
| Machine registry + dashboard | ✅ |
| White-label branding | ✅ |
| Unattended access (systemd) | ✅ |
| Tauri native client (scaffold) | 🚧 |
| Hardware-accelerated encoding | 📋 |
| Mobile viewer | 📋 |
| SSO / OIDC | 📋 |

---

## Quick Start — Self-Hosted

```bash
git clone https://github.com/your-org/peerdesk
cd peerdesk/deploy
bash install.sh
```

The installer will:
1. Check Docker is installed (offer to install if missing)
2. Ask for your domain / server IP
3. Ask if you want HTTPS (Let's Encrypt)
4. Generate random secrets
5. Build and start all services
6. Run database migrations
7. Print your dashboard URL

> **Minimum:** Ubuntu 20.04+, Debian 11+, CentOS 8+. Docker + Docker Compose v2.

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

- Ubuntu 24.04 (or similar)
- Rust 1.78+ (`rustup`)
- Node.js 20 (`nvm`)
- Python 3.12
- Docker + Docker Compose v2
- System deps: `libx11-dev libxcb1-dev libssl-dev clang libxdo-dev libasound2-dev`

### Dev stack (signaling + api + postgres + redis)

```bash
cd deploy
docker compose -f docker-compose.dev.yml up -d

# First time: run migrations
docker compose -f docker-compose.dev.yml exec -T api alembic upgrade head
```

### Run everything locally

```bash
# 1. Virtual display (Linux)
Xvfb :99 -screen 0 1280x720x24 &
DISPLAY=:99 fluxbox &
DISPLAY=:99 xterm &

# 2. Agent
DISPLAY=:99 PEERDESK_PASSWORD=test123 SIGNALING_URL=ws://localhost:8001/ws \
  cargo run -p peerdesk-agent

# 3. Web viewer
cd web && npm run dev -- --host 0.0.0.0

# 4. Open http://localhost:5173
#    Register → Dashboard → Connect (or enter 9-digit ID + password)
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
- **Connection approval** — agent auto-approves (configurable UI prompt in roadmap)
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
