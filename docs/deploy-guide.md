# PeerDesk — Complete Deployment Guide

> Covers: **local dev**, **production with nginx**, **production without nginx**, and **automated testing**.

---

## Deployment modes — quick pick

| File | When to use it |
|---|---|
| `docker-compose.dev.yml` | Local development — Vite dev server with hot reload, all services in Docker |
| `docker-compose.yml` | Production with nginx included — internal nginx proxy, SSL, single entry point on port 80/443 |
| `docker-compose.no-nginx.yml` | Production without internal nginx — when you already have Traefik / Caddy / external nginx proxying to services |

---

## Contents

1. [Requirements](#1-requirements)
2. [Dev — Quick Start](#2-dev--quick-start)
3. [Production — Full Deployment](#3-production--full-deployment)
4. [Production without Internal nginx (Behind an External Proxy)](#4-production-without-internal-nginx-behind-an-external-proxy)
5. [Automated Testing](#5-automated-testing)
6. [Updating the Application](#6-updating-the-application)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Requirements

### Server (Linux — Ubuntu 22.04 / 24.04 recommended)

| Component | Minimum version | Install |
|---|---|---|
| Docker Engine | 24+ | `curl -fsSL https://get.docker.com | sh` |
| Docker Compose | v2 (plugin) | included in Docker Engine 24+ |
| Rust / Cargo | 1.78+ | `curl https://sh.rustup.rs -sSf | sh` |
| Node.js | 20 LTS | `nvm install 20` |
| Git | any | `apt install git` |

### Required ports (open on the firewall)

| Port | Protocol | Service |
|---|---|---|
| 80 | TCP | nginx (HTTP / redirect) |
| 443 | TCP | nginx (HTTPS) |
| 3478 | TCP+UDP | coturn TURN server |
| 49152–65535 | UDP | coturn media relay |

---

## 2. Dev — Quick Start

The whole stack runs in Docker — including the Vite dev server with hot reload.

### 2.1 Clone

```bash
git clone <repo-url> peerdesk
cd peerdesk
```

### 2.2 Start the full stack

```bash
cd deploy
docker compose -f docker-compose.dev.yml up -d
```

The first start builds the images (~2 min). Subsequent starts are instant.

Check:

```bash
docker compose -f docker-compose.dev.yml ps
# All services must be Up: postgres, redis, signaling, api, web

curl http://localhost:8001/health   # → {"status":"ok"}
curl http://localhost:8000/health   # → {"status":"ok"}
```

Open a browser to **`http://localhost:5173`** (or `http://<IP-SERVER>:5173` from another machine).

### 2.3 Virtual display (needed on a headless server)

Needed for the Rust agent that captures the screen:

```bash
pkill -f "Xvfb :99" 2>/dev/null; rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1920x1080x24 &
apt-get install -y fluxbox &>/dev/null
DISPLAY=:99 fluxbox &
DISPLAY=:99 xterm &
```

### 2.4 Start the Rust agent

```bash
source ~/.cargo/env

DISPLAY=:99 \
PEERDESK_PASSWORD=testpass123 \
SIGNALING_URL=ws://localhost:8001/ws \
  cargo run -p peerdesk-agent 2>&1 | tee /tmp/agent.log &

sleep 4
grep "peer_id=" /tmp/agent.log
# Output: PeerDesk agent — peer_id=123456789
```

### 2.5 Hot reload

Changes in `web/src/` show up instantly in the browser without a restart.
Changes in `server/api/` or `server/signaling/` are picked up automatically by uvicorn `--reload`.

### 2.6 Stop dev

```bash
cd deploy
docker compose -f docker-compose.dev.yml down
pkill -f "peerdesk-agent" 2>/dev/null
pkill -f "Xvfb :99" 2>/dev/null
```

---

## 3. Production — Full Deployment

**Recommended method** — `install.sh` does everything automatically:

```bash
cd deploy
bash install.sh
# choose option 2 (Production + nginx)
```

Or non-interactively:
```bash
bash install.sh --domain peerdesk.example.com --tls --email admin@example.com
```

The manual steps below are for special cases or debugging.

### 3.1 Environment variable setup (manual)

```bash
cd deploy
cp .env.example .env
nano .env
```

Fill in:

```env
POSTGRES_PASSWORD=<strong-password>
JWT_SECRET=<openssl rand -hex 32>
TURN_SECRET=<openssl rand -hex 24>
```

Generate secrets:

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "TURN_SECRET=$(openssl rand -hex 24)"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
```

### 3.2 SSL certificates (Let's Encrypt recommended)

```bash
apt install certbot
certbot certonly --standalone -d domain.com

mkdir -p deploy/nginx/certs
cp /etc/letsencrypt/live/domain.com/fullchain.pem deploy/nginx/certs/
cp /etc/letsencrypt/live/domain.com/privkey.pem   deploy/nginx/certs/
```

### 3.3 Build and start production

```bash
cd deploy
docker compose build --no-cache
docker compose up -d

docker compose ps
docker compose logs -f --tail 50
```

### 3.4 Database migrations

```bash
# Runs automatically at startup; or manually:
docker compose exec api alembic upgrade head
```

### 3.5 Install the agent as a systemd service

```bash
# On the machine that will be accessed remotely:
cargo build -p peerdesk-agent --release
sudo cp target/release/peerdesk-agent /usr/local/bin/
sudo cp deploy/systemd/peerdesk-agent.service /etc/systemd/system/

# Configuration (add Environment= in the override)
sudo systemctl edit peerdesk-agent
# [Service]
# Environment=PEERDESK_PASSWORD=your_password
# Environment=SIGNALING_URL=wss://domain.com/ws

sudo systemctl daemon-reload
sudo systemctl enable --now peerdesk-agent
sudo systemctl status peerdesk-agent
```

### 3.6 Pre-launch production checklist

- [ ] `.env` filled in with real values (no CHANGE_ME)
- [ ] SSL certificates in `deploy/nginx/certs/`
- [ ] Firewall: ports 80, 443, 3478, 49152-65535 open
- [ ] `docker compose ps` — all containers `healthy`
- [ ] `curl https://domain.com/api/health` → `{"status":"ok"}`
- [ ] `curl https://domain.com/ws/health` → `{"status":"ok"}`
- [ ] Agent started on at least one test machine
- [ ] Connection test from a browser at `https://domain.com`
- [ ] Automatic renewal: `certbot renew --dry-run`

### 3.7 Publishing through an external proxy (Nginx Proxy Manager, Traefik, etc.)

The variant where you **keep the internal nginx** and put a proxy in front of it —
typical when you already have a reverse proxy that manages certificates for
multiple domains. This differs from section 4: there, the internal nginx is
absent entirely.

Notation: `<PUBLIC_DOMAIN>` = the public domain (e.g. `app.example.com`),
`<DDNS_HOST>` = the DDNS name that tracks your public IP,
`<PEERDESK_HOST_IP>` = the machine with the PeerDesk stack, `<PROXY_IP>` = the proxy.

#### Traffic path

```
browser / agent   <PUBLIC_DOMAIN> :443 → proxy → <PEERDESK_HOST_IP>:80
TURN relay (UDP)  <DDNS_HOST> :3478   → direct → <PEERDESK_HOST_IP>:3478
```

TURN **cannot** go through the proxy: the relay is UDP, and an HTTP reverse
proxy does not carry UDP.

#### Router port forwarding

| Port | Protocol | To | Why |
|---|---|---|---|
| 80 | TCP | `<PROXY_IP>` | Let's Encrypt HTTP-01 validation |
| 443 | TCP | `<PROXY_IP>` | the web app |
| **3478** | **TCP + UDP** | **`<PEERDESK_HOST_IP>`** | TURN control |
| **49160-49200** | **UDP** | **`<PEERDESK_HOST_IP>`** | TURN relayed media |

The last two bypass the proxy. If they are missing, a viewer on another
network connects, authenticates — and is left with a **black screen and no
error message**, the hardest failure in the system to diagnose.

#### Proxy configuration

The target is port **80**, not 443: the internal nginx has no `listen 443`
block, so 443 would refuse the connection. TLS terminates at the proxy; the
hop within the LAN stays HTTP.

- **Websockets Support: ON.** Every session is negotiated over `/ws`; without
  it the agent cannot register and nothing connects.
- For binary downloads (20–85 MB), disable buffering — otherwise the proxy
  writes the entire response to a temp file before the user sees the first
  byte:

```nginx
location /api/releases/download/ {
    proxy_pass http://<PEERDESK_HOST_IP>:80;
    proxy_buffering off;
    proxy_read_timeout 300s;
}
```

#### Adjustments on the PeerDesk server

| Setting | Value | Why |
|---|---|---|
| `TURN_HOST` | `<DDNS_HOST>` | a private address here means external viewers get an unreachable relay |
| `TURN_PRIVATE_IP` | `<PEERDESK_HOST_IP>` | lets coturn map private → public behind NAT |
| `set_real_ip_from` | `<PROXY_IP>` | without it every visitor looks like the proxy, and the per-IP rate limiter puts the whole internet in one bucket |

`deploy/nginx/default.conf` **overwrites** `X-Forwarded-For` on `/ws` — it
does not append to it. The signaling server trusts the first entry, so any
header sent by the client must be stripped there; otherwise a client could
spoof its source IP, fooling the rate limiter and the audit log.

#### Verification — in this order

Each step isolates one hop; the first failure shows where the break is.

```bash
# 1. the app responds over TLS               → 200
curl -sS -o /dev/null -w '%{http_code}\n' https://<PUBLIC_DOMAIN>/

# 2. the API responds through the proxy       → JSON with "tag_name"
curl -sS https://<PUBLIC_DOMAIN>/api/releases/latest | head -c 120

# 3. WebSockets survive                        → 101 (the step most often skipped)
#    --http1.1 is REQUIRED, see the note below
curl -sS --http1.1 -o /dev/null -w '%{http_code}\n' \
  -H 'Connection: Upgrade' -H 'Upgrade: websocket' \
  -H 'Sec-WebSocket-Version: 13' -H 'Sec-WebSocket-Key: dGhlIHNhbXBsZSBub25jZQ==' \
  https://<PUBLIC_DOMAIN>/ws

# 4. the real IP reaches signaling (not the proxy's)
cd deploy && docker compose logs --tail=20 signaling | grep connection_attempt

# 5. TURN is reachable from outside the network (from mobile data / a VPS)
nc -zvu <DDNS_HOST> 3478
```

A `101` at step 3 confirms WebSocket support; a `200` or `400` means the
option is disabled in the proxy.

> **Without `--http1.1`, step 3 gives a false result.** If the proxy offers
> HTTP/2, curl negotiates it automatically — and the `Connection: Upgrade`
> mechanism does not exist in HTTP/2, so the headers are ignored. The request
> reaches signaling as a plain GET, which responds `404 {"detail":"Not
> Found"}`. It looks exactly like a broken WebSocket, even though everything
> works. Browsers do not have this problem: they open the handshake over
> HTTP/1.1.

A `101` followed by a curl timeout is the **correct result** — the
connection has been upgraded, and curl is waiting for data nobody is
sending it.

At step 5, test with <https://icetest.info> and expect at least one `relay`
candidate — its absence means the UDP forwards are missing.

#### Pitfalls

**Do not enable the Cloudflare proxy (orange cloud)** on the domain used for
TURN. The domain would resolve to Cloudflare, which does not carry UDP 3478,
and the relay dies silently. This is why `TURN_HOST` uses the DDNS name, not
the public domain.

**If the public IP is dynamic**, coturn resolves it **once, at startup**.
When it changes, the relay keeps announcing the old address:

```bash
cd deploy && docker compose restart coturn
```

**Editing `deploy/nginx/default.conf` requires a recreate, not a reload.**
The file is a bind mount and Docker tracks the *inode*: an edit that
rewrites the file leaves the container reading the old version, and
`nginx -t` happily validates the stale copy.

```bash
docker compose up -d --force-recreate --no-deps nginx
```

**Existing agents do not migrate on their own.** They are configured with
the old URL; only new installs use the domain. To move one, reinstall it
with `--server=https://<PUBLIC_DOMAIN>` and a new token.

---

## 4. Production without Internal nginx (Behind an External Proxy)

Use `docker-compose.no-nginx.yml` when:
- You already have **Traefik**, **Caddy**, **external nginx**, or another reverse proxy that handles SSL and routing
- You want to expose the services directly on ports and control the proxy yourself

### 4.1 Exposed services and ports

| Service | Port | Description |
|---|---|---|
| `web` | 80 | React app (internal nginx in the container) |
| `api` | 8000 | FastAPI REST API |
| `signaling` | 8001 | WebSocket signaling |
| `coturn` | 3478 | TURN server (host network) |

### 4.2 config.json for this mode

The URLs must be absolute — the client's browser uses them directly:

```json
{
  "apiUrl": "http://192.168.1.100:8000",
  "signalingUrl": "ws://192.168.1.100:8001/ws"
}
```

Or with HTTPS if the external proxy terminates SSL:

```json
{
  "apiUrl": "https://domain.com:8000",
  "signalingUrl": "wss://domain.com:8001/ws"
}
```

### 4.3 Start

```bash
cd deploy
cp .env.example .env && nano .env   # fill in POSTGRES_PASSWORD, JWT_SECRET, TURN_SECRET
docker compose -f docker-compose.no-nginx.yml up -d
```

### 4.4 External proxy configuration (examples)

**External Nginx** — add to the site config:

```nginx
# React app
location / {
    proxy_pass http://localhost:80;
}

# API
location /api/ {
    rewrite ^/api/(.*) /$1 break;
    proxy_pass http://localhost:8000;
}

# WebSocket signaling
location /ws {
    proxy_pass http://localhost:8001;
    proxy_http_version 1.1;
    proxy_set_header Upgrade $http_upgrade;
    proxy_set_header Connection "upgrade";
    proxy_read_timeout 3600s;
}
```

If the external nginx terminates SSL on the same machine, `config.json` can use relative paths (`/api`, `/ws`) exactly as in the internal-nginx mode.

**Traefik / Caddy** — route by port; consult the respective documentation for WebSocket upgrade headers.

---

## 5. Automated Testing

### Main script

```bash
# Dev (starts the stack if it is not running)
bash docs/test-all.sh

# Skip the Rust/Node build (faster if you already have the binaries)
bash docs/test-all.sh --skip-build

# Test the prod stack on port 80
bash docs/test-all.sh --prod
```

### What `test-all.sh` tests

| # | Section | What it checks |
|---|---|---|
| 1 | System requirements | docker, curl, cargo, node, websocat |
| 2 | Docker services | containers started, health |
| 3 | HTTP health | signaling /health, API /health, OpenAPI docs |
| 4 | Auth API | register, duplicate email, login, wrong password, refresh |
| 5 | Machines & Sessions | CRUD, heartbeat, create/end session |
| 6 | WebSocket signaling | register agent, join invalid, malformed JSON |
| 7 | Rust agent | `cargo build --release`, `cargo test` |
| 8 | Web frontend | `npm run build`, `tsc --noEmit` |

### Manual WebSocket testing

Requires `websocat` (`cargo install websocat`):

```bash
# Register agent
echo '{"type":"register","peer_id":"123456789","password_hash":"<sha256>"}' \
  | websocat ws://localhost:8001/ws

# Join as viewer
echo '{"type":"join","peer_id":"123456789","password":"testpass123"}' \
  | websocat ws://localhost:8001/ws
```

### Quick curl API testing

```bash
# Health
curl http://localhost:8000/health

# Register + Login
curl -X POST http://localhost:8000/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","name":"Admin","password":"Admin123!"}'

TOKEN=$(curl -s -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@test.com","password":"Admin123!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['access_token'])")

# List machines
curl http://localhost:8000/machines -H "Authorization: Bearer $TOKEN"
```

---

## 6. Updating the Application

```bash
git pull

cd deploy
docker compose build --no-cache api signaling web
docker compose up -d --no-deps api signaling web

# New migrations (if any)
docker compose exec api alembic upgrade head

# Agent on remote machines
cargo build -p peerdesk-agent --release
sudo cp target/release/peerdesk-agent /usr/local/bin/
sudo systemctl restart peerdesk-agent
```

---

## 7. Troubleshooting

### Docker stack does not start

```bash
docker compose -f deploy/docker-compose.dev.yml logs
docker compose -f deploy/docker-compose.dev.yml logs api
```

### Agent does not show online

```bash
journalctl -u peerdesk-agent -f
# or:
tail -f /tmp/agent.log

# Common causes:
# - Wrong SIGNALING_URL (wss:// prod, ws:// dev)
# - Port 8001 blocked by firewall or nginx
# - DISPLAY not set / Xvfb not running
```

### "Machine not found" in the browser

```bash
grep "peer_id=" /tmp/agent.log
grep "Registered with signaling" /tmp/agent.log
```

### ICE / WebRTC does not connect

```bash
docker compose logs coturn | tail -20
nc -u -z -v <IP-SERVER> 3478   # check the TURN port
# On LXC: ICE over IPv6 can fail (normal) — IPv4 must work
```

### Postgres is not healthy

```bash
docker compose exec postgres pg_isready -U peerdesk
# Old incompatible data:
docker compose down -v && docker compose up -d
```

### SSL certificate expired

```bash
certbot renew
cp /etc/letsencrypt/live/domain.com/fullchain.pem deploy/nginx/certs/
cp /etc/letsencrypt/live/domain.com/privkey.pem   deploy/nginx/certs/
docker compose restart nginx
```
