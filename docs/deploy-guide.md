# PeerDesk — Ghid complet de deployment

> Acoperă: **dev local**, **producție cu nginx**, **producție fără nginx** și **testare automată**.

---

## Moduri de deployment — alegere rapidă

| Fișier | Când îl folosești |
|---|---|
| `docker-compose.dev.yml` | Dezvoltare locală — Vite dev server cu hot reload, toate serviciile în Docker |
| `docker-compose.yml` | Producție cu nginx inclus — nginx proxy intern, SSL, singur punct de intrare pe port 80/443 |
| `docker-compose.no-nginx.yml` | Producție fără nginx intern — când ai deja Traefik / Caddy / nginx extern care face proxy spre servicii |

---

## Cuprins

1. [Cerințe](#1-cerinte)
2. [Dev — pornire rapidă (tot în Docker)](#2-dev--pornire-rapida)
3. [Producție cu nginx inclus](#3-productie--deployment-complet)
4. [Producție fără nginx intern](#4-productie-fara-nginx-intern-in-spatele-unui-proxy-extern)
5. [Testare automată](#5-testare-automata)
6. [Actualizare aplicație](#6-actualizare-aplicatie)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Cerinte

### Server (Linux — Ubuntu 22.04 / 24.04 recomandat)

| Componenta | Versiune minima | Instalare |
|---|---|---|
| Docker Engine | 24+ | `curl -fsSL https://get.docker.com | sh` |
| Docker Compose | v2 (plugin) | inclus în Docker Engine 24+ |
| Rust / Cargo | 1.78+ | `curl https://sh.rustup.rs -sSf | sh` |
| Node.js | 20 LTS | `nvm install 20` |
| Git | orice | `apt install git` |

### Porturi necesare (deschide pe firewall)

| Port | Protocol | Serviciu |
|---|---|---|
| 80 | TCP | nginx (HTTP / redirect) |
| 443 | TCP | nginx (HTTPS) |
| 3478 | TCP+UDP | coturn TURN server |
| 49152–65535 | UDP | coturn media relay |

---

## 2. Dev — pornire rapida

Tot stack-ul rulează în Docker — inclusiv Vite dev server cu hot reload.

### 2.1 Clonare

```bash
git clone <repo-url> peerdesk
cd peerdesk
```

### 2.2 Pornire stack complet

```bash
cd deploy
docker compose -f docker-compose.dev.yml up -d
```

Prima pornire construiește imaginile (~2 min). La reporniri ulterioare e instant.

Verifică:

```bash
docker compose -f docker-compose.dev.yml ps
# Toate serviciile trebuie să fie Up: postgres, redis, signaling, api, web

curl http://localhost:8001/health   # → {"status":"ok"}
curl http://localhost:8000/health   # → {"status":"ok"}
```

Deschide browser la **`http://localhost:5173`** (sau `http://<IP-SERVER>:5173` de pe altă mașinărie).

### 2.3 Display virtual (necesar pe server fără monitor)

Necesar pentru agentul Rust care capturează ecranul:

```bash
pkill -f "Xvfb :99" 2>/dev/null; rm -f /tmp/.X99-lock
Xvfb :99 -screen 0 1920x1080x24 &
apt-get install -y fluxbox &>/dev/null
DISPLAY=:99 fluxbox &
DISPLAY=:99 xterm &
```

### 2.4 Pornire agent Rust

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

Modificările în `web/src/` sunt reflectate instant în browser fără restart.
Modificările în `server/api/` sau `server/signaling/` sunt preluate automat de uvicorn `--reload`.

### 2.6 Oprire dev

```bash
cd deploy
docker compose -f docker-compose.dev.yml down
pkill -f "peerdesk-agent" 2>/dev/null
pkill -f "Xvfb :99" 2>/dev/null
```

---

## 3. Productie — deployment complet

**Metoda recomandată** — `install.sh` face totul automat:

```bash
cd deploy
bash install.sh
# alege opțiunea 2 (Producție + nginx)
```

Sau non-interactiv:
```bash
bash install.sh --domain peerdesk.example.com --tls --email admin@example.com
```

Pașii manuali de mai jos sunt pentru cazuri speciale sau debugging.

### 3.1 Configurare variabile de mediu (manual)

```bash
cd deploy
cp .env.example .env
nano .env
```

Completează:

```env
POSTGRES_PASSWORD=<parola-puternica>
JWT_SECRET=<openssl rand -hex 32>
TURN_SECRET=<openssl rand -hex 24>
```

Generare secrete:

```bash
echo "JWT_SECRET=$(openssl rand -hex 32)"
echo "TURN_SECRET=$(openssl rand -hex 24)"
echo "POSTGRES_PASSWORD=$(openssl rand -hex 16)"
```

### 3.2 Certificate SSL (Let's Encrypt recomandat)

```bash
apt install certbot
certbot certonly --standalone -d domain.com

mkdir -p deploy/nginx/certs
cp /etc/letsencrypt/live/domain.com/fullchain.pem deploy/nginx/certs/
cp /etc/letsencrypt/live/domain.com/privkey.pem   deploy/nginx/certs/
```

### 3.3 Build și pornire producție

```bash
cd deploy
docker compose build --no-cache
docker compose up -d

docker compose ps
docker compose logs -f --tail 50
```

### 3.4 Migrări bază de date

```bash
# Rulează automat la startup; sau manual:
docker compose exec api alembic upgrade head
```

### 3.5 Instalare agent ca serviciu systemd

```bash
# Pe mașina care va fi accesată remote:
cargo build -p peerdesk-agent --release
sudo cp target/release/peerdesk-agent /usr/local/bin/
sudo cp deploy/systemd/peerdesk-agent.service /etc/systemd/system/

# Configurare (adaugă Environment= în override)
sudo systemctl edit peerdesk-agent
# [Service]
# Environment=PEERDESK_PASSWORD=parola_ta
# Environment=SIGNALING_URL=wss://domain.com/ws

sudo systemctl daemon-reload
sudo systemctl enable --now peerdesk-agent
sudo systemctl status peerdesk-agent
```

### 3.6 Checklist pre-launch producție

- [ ] `.env` completat cu valori reale (fără CHANGE_ME)
- [ ] Certificate SSL în `deploy/nginx/certs/`
- [ ] Firewall: porturi 80, 443, 3478, 49152-65535 deschise
- [ ] `docker compose ps` — toate containerele `healthy`
- [ ] `curl https://domain.com/api/health` → `{"status":"ok"}`
- [ ] `curl https://domain.com/ws/health` → `{"status":"ok"}`
- [ ] Agent pornit pe cel puțin o mașinărie de test
- [ ] Test conexiune din browser la `https://domain.com`
- [ ] Renewal automat: `certbot renew --dry-run`

---

## 4. Productie fără nginx intern (în spatele unui proxy extern)

Folosește `docker-compose.no-nginx.yml` când:
- Ai deja **Traefik**, **Caddy**, **nginx extern** sau alt reverse proxy care gestionează SSL și routing
- Vrei să expui serviciile direct pe porturi și tu controlezi proxy-ul

### 4.1 Servicii și porturi expuse

| Serviciu | Port | Descriere |
|---|---|---|
| `web` | 80 | React app (nginx intern în container) |
| `api` | 8000 | REST API FastAPI |
| `signaling` | 8001 | WebSocket signaling |
| `coturn` | 3478 | TURN server (host network) |

### 4.2 config.json pentru acest mod

URL-urile trebuie să fie absolute — browserul clientului le folosește direct:

```json
{
  "apiUrl": "http://192.168.1.100:8000",
  "signalingUrl": "ws://192.168.1.100:8001/ws"
}
```

Sau cu HTTPS dacă proxy-ul extern termină SSL:

```json
{
  "apiUrl": "https://domain.com:8000",
  "signalingUrl": "wss://domain.com:8001/ws"
}
```

### 4.3 Pornire

```bash
cd deploy
cp .env.example .env && nano .env   # completează POSTGRES_PASSWORD, JWT_SECRET, TURN_SECRET
docker compose -f docker-compose.no-nginx.yml up -d
```

### 4.4 Configurare proxy extern (exemple)

**Nginx extern** — adaugă în site config:

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

Dacă nginx extern termină SSL pe aceeași mașinărie, `config.json` poate folosi căi relative (`/api`, `/ws`) exact ca în modul cu nginx intern.

**Traefik / Caddy** — rutează după port; consultă documentația respectivă pentru WebSocket upgrade headers.

---

## 5. Testare automata

### Script principal

```bash
# Dev (pornește stack-ul dacă nu rulează)
bash docs/test-all.sh

# Sare compilarea Rust/Node (mai rapid dacă ai deja binarele)
bash docs/test-all.sh --skip-build

# Testează stack-ul de prod pe portul 80
bash docs/test-all.sh --prod
```

### Ce testează `test-all.sh`

| # | Secțiune | Ce verifică |
|---|---|---|
| 1 | Cerințe sistem | docker, curl, cargo, node, websocat |
| 2 | Docker services | containere pornite, health |
| 3 | Health HTTP | signaling /health, API /health, OpenAPI docs |
| 4 | Auth API | register, duplicate email, login, parola greșită, refresh |
| 5 | Machines & Sessions | CRUD, heartbeat, create/end session |
| 6 | WebSocket signaling | register agent, join invalid, JSON malformat |
| 7 | Agent Rust | `cargo build --release`, `cargo test` |
| 8 | Frontend web | `npm run build`, `tsc --noEmit` |

### Testare WebSocket manual

Necesită `websocat` (`cargo install websocat`):

```bash
# Register agent
echo '{"type":"register","peer_id":"123456789","password_hash":"<sha256>"}' \
  | websocat ws://localhost:8001/ws

# Join ca viewer
echo '{"type":"join","peer_id":"123456789","password":"testpass123"}' \
  | websocat ws://localhost:8001/ws
```

### Testare API curl rapid

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

# Listare mașini
curl http://localhost:8000/machines -H "Authorization: Bearer $TOKEN"
```

---

## 6. Actualizare aplicatie

```bash
git pull

cd deploy
docker compose build --no-cache api signaling web
docker compose up -d --no-deps api signaling web

# Migrări noi (dacă există)
docker compose exec api alembic upgrade head

# Agent pe mașinile remote
cargo build -p peerdesk-agent --release
sudo cp target/release/peerdesk-agent /usr/local/bin/
sudo systemctl restart peerdesk-agent
```

---

## 7. Troubleshooting

### Stack Docker nu pornește

```bash
docker compose -f deploy/docker-compose.dev.yml logs
docker compose -f deploy/docker-compose.dev.yml logs api
```

### Agentul nu apare online

```bash
journalctl -u peerdesk-agent -f
# sau:
tail -f /tmp/agent.log

# Cauze comune:
# - SIGNALING_URL greșit (wss:// prod, ws:// dev)
# - Port 8001 blocat de firewall sau nginx
# - DISPLAY nesetat / Xvfb nu rulează
```

### „Machine not found" în browser

```bash
grep "peer_id=" /tmp/agent.log
grep "Registered with signaling" /tmp/agent.log
```

### ICE / WebRTC nu se conectează

```bash
docker compose logs coturn | tail -20
nc -u -z -v <IP-SERVER> 3478   # verifică portul TURN
# Pe LXC: ICE pe IPv6 poate eșua (normal) — IPv4 trebuie să funcționeze
```

### Postgres nu e healthy

```bash
docker compose exec postgres pg_isready -U peerdesk
# Date vechi incompatibile:
docker compose down -v && docker compose up -d
```

### Certificat SSL expirat

```bash
certbot renew
cp /etc/letsencrypt/live/domain.com/fullchain.pem deploy/nginx/certs/
cp /etc/letsencrypt/live/domain.com/privkey.pem   deploy/nginx/certs/
docker compose restart nginx
```
