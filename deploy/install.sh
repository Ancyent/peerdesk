#!/usr/bin/env bash
# PeerDesk installer — rulează din deploy/
# Usage: bash install.sh [--dev] [--no-nginx] [--domain DOMAIN] [--tls] [--email EMAIL]
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'
BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${GREEN}✓${NC}  $*"; }
warn()  { echo -e "${YELLOW}!${NC}  $*"; }
error() { echo -e "${RED}✗${NC}  $*" >&2; exit 1; }
ask()   { echo -e "${BLUE}?${NC}  $*"; }
step()  { echo -e "\n${BOLD}── $* ──${NC}"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo -e "${BOLD}"
cat << 'BANNER'
  ____                 ____            _
 |  _ \ ___  ___ _ __|  _ \  ___  ___| | __
 | |_) / _ \/ _ \ '__| | | |/ _ \/ __| |/ /
 |  __/  __/  __/ |  | |_| |  __/\__ \   <
 |_|   \___|\___|_|  |____/ \___||___/_|\_\
BANNER
echo -e "${NC}"

# ── Argumente CLI (opționale, pentru scripting/CI) ────────
MODE=""
DOMAIN=""
USE_TLS="n"
ADMIN_EMAIL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --dev)      MODE="dev" ;;
    --no-nginx) MODE="prod-direct" ;;
    --domain)   DOMAIN="$2"; shift ;;
    --tls)      USE_TLS="y" ;;
    --email)    ADMIN_EMAIL="$2"; shift ;;
  esac
  shift
done

# ── Docker ────────────────────────────────────────────────
step "Docker"

if ! command -v docker &>/dev/null; then
  warn "Docker nu este instalat."
  ask "Instalez automat? [Y/n]: "
  read -r ans
  [[ "${ans:-Y}" =~ ^[Yy]$ ]] || error "Instalează Docker de la https://docs.docker.com/get-docker/"
  info "Instalez Docker..."
  curl -fsSL https://get.docker.com | sh
  info "Docker instalat."
fi
docker compose version &>/dev/null || error "Docker Compose v2 lipsă. Actualizează Docker."
info "Docker $(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1) — OK"

# ── Mod deployment ────────────────────────────────────────
step "Mod de deployment"

if [[ -z "$MODE" ]]; then
  echo ""
  echo "  1) Dev (local)         — hot reload, toate în Docker, port :5173"
  echo "  2) Producție + nginx   — nginx intern, SSL opțional, port :80/:443"
  echo "  3) Producție direct    — porturi directe, proxy extern (Traefik/Caddy)"
  echo ""
  ask "Alege [1/2/3]: "
  read -r choice
  case "${choice:-1}" in
    1) MODE="dev" ;;
    2) MODE="prod-nginx" ;;
    3) MODE="prod-direct" ;;
    *) error "Opțiune invalidă." ;;
  esac
fi

# ─────────────────────────────────────────────────────────
# DEV MODE
# ─────────────────────────────────────────────────────────
if [[ "$MODE" == "dev" ]]; then
  step "Pornire stack dev"
  info "Construiesc imagini și pornesc (prima rulare ~2 min)..."
  docker compose -f docker-compose.dev.yml up -d --build

  info "Aștept serviciile..."
  for i in $(seq 1 40); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:8000/health 2>/dev/null || echo "000")
    [[ "$code" == "200" ]] && break
    sleep 2
  done

  echo ""
  echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}${BOLD}  Stack dev pornit!${NC}"
  echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""

  # Detectează IP-ul pentru acces de pe altă mașinărie
  LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[\d.]+' || echo "localhost")
  echo -e "  Browser  →  ${BLUE}${BOLD}http://localhost:5173${NC}"
  [[ "$LOCAL_IP" != "localhost" ]] && \
    echo -e "  Rețea    →  ${BLUE}http://${LOCAL_IP}:5173${NC}"
  echo ""
  echo "  Modificările din cod sunt reîncărcate automat."
  echo ""
  echo "  Log-uri:  docker compose -f docker-compose.dev.yml logs -f"
  echo "  Oprire:   docker compose -f docker-compose.dev.yml down"
  echo ""
  exit 0
fi

# ─────────────────────────────────────────────────────────
# PROD MODE — colectare config
# ─────────────────────────────────────────────────────────
step "Configurare"

if [[ -z "$DOMAIN" ]]; then
  ask "Domeniu sau IP server (ex: peerdesk.example.com sau 192.168.1.10): "
  read -r DOMAIN
  [[ -z "$DOMAIN" ]] && error "Domeniu/IP obligatoriu."
fi

if [[ "$MODE" == "prod-nginx" && "$USE_TLS" == "n" ]]; then
  ask "Activez HTTPS cu Let's Encrypt? (necesită DNS configurat) [y/N]: "
  read -r tls_ans
  USE_TLS="${tls_ans:-n}"
fi

if [[ "$USE_TLS" =~ ^[Yy]$ && -z "$ADMIN_EMAIL" ]]; then
  ask "Email pentru certificat SSL: "
  read -r ADMIN_EMAIL
  [[ -z "$ADMIN_EMAIL" ]] && error "Email obligatoriu pentru Let's Encrypt."
fi

[[ "$USE_TLS" =~ ^[Yy]$ ]] && SCHEME="https" && WS_SCHEME="wss" || SCHEME="http" && WS_SCHEME="ws"

# ── .env ──────────────────────────────────────────────────
step "Credențiale"

if [[ -f .env ]]; then
  warn ".env există — păstrez secretele. Șterge .env pentru a regenera."
  set -a; source .env 2>/dev/null || true; set +a
else
  PG_PASS=$(openssl rand -hex 24)
  JWT_SEC=$(openssl rand -hex 32)
  TURN_SEC=$(openssl rand -hex 24)

  cat > .env << EOF
POSTGRES_USER=peerdesk
POSTGRES_PASSWORD=${PG_PASS}
POSTGRES_DB=peerdesk
JWT_SECRET=${JWT_SEC}
TURN_SECRET=${TURN_SEC}
EOF
  chmod 600 .env

  info "Creat .env cu secrete random:"
  info "  DB password:   ${PG_PASS:0:8}…"
  info "  JWT secret:    ${JWT_SEC:0:8}…"
  info "  TURN secret:   ${TURN_SEC:0:8}…"
  set -a; source .env; set +a
fi

# ── config.json ───────────────────────────────────────────
step "config.json"

if [[ "$MODE" == "prod-nginx" ]]; then
  # nginx pe același domeniu → căi relative
  cat > config.json << 'EOF'
{
  "apiUrl": "/api",
  "signalingUrl": "/ws"
}
EOF
  info "config.json: căi relative (nginx proxy intern)"
else
  # Fără nginx → URL-uri absolute cu port
  cat > config.json << EOF
{
  "apiUrl": "${SCHEME}://${DOMAIN}:8000",
  "signalingUrl": "${WS_SCHEME}://${DOMAIN}:8001/ws"
}
EOF
  info "config.json: URL-uri directe (${SCHEME}://${DOMAIN}:8000)"
fi

# ── TLS ───────────────────────────────────────────────────
if [[ "$USE_TLS" =~ ^[Yy]$ ]]; then
  step "Certificate SSL"

  if ! command -v certbot &>/dev/null; then
    info "Instalez certbot..."
    if   command -v apt-get &>/dev/null; then apt-get install -y certbot
    elif command -v dnf     &>/dev/null; then dnf install -y certbot
    else error "Instalează certbot manual și re-rulează."; fi
  fi

  certbot certonly --standalone -d "$DOMAIN" \
    --agree-tos --non-interactive --email "$ADMIN_EMAIL"

  mkdir -p nginx/certs
  cp /etc/letsencrypt/live/"$DOMAIN"/fullchain.pem nginx/certs/cert.pem
  cp /etc/letsencrypt/live/"$DOMAIN"/privkey.pem   nginx/certs/key.pem
  chmod 600 nginx/certs/key.pem
  info "Certificate copiate în nginx/certs/"

  cat > nginx/default.conf << 'NGINXEOF'
upstream api       { server api:8000; }
upstream signaling { server signaling:8001; }
upstream web_app   { server web:80; }

server {
    listen 80;
    server_name _;
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl;
    server_name _;
    ssl_certificate     /etc/nginx/certs/cert.pem;
    ssl_certificate_key /etc/nginx/certs/key.pem;
    ssl_protocols       TLSv1.2 TLSv1.3;
    ssl_ciphers         HIGH:!aNULL:!MD5;
    ssl_session_cache   shared:SSL:10m;
    client_max_body_size 10m;

    location = /config.json {
        alias /etc/peerdesk/config.json;
        add_header Cache-Control "no-cache, no-store";
        add_header Content-Type "application/json";
    }

    location /ws {
        proxy_pass http://signaling;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location /api/ {
        rewrite ^/api/(.*) /$1 break;
        proxy_pass http://api;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://web_app;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
NGINXEOF
  info "nginx configurat pentru HTTPS + redirect HTTP→HTTPS"
fi

# ── Build și pornire ──────────────────────────────────────
step "Build și pornire"

COMPOSE_FILE="docker-compose.yml"
[[ "$MODE" == "prod-direct" ]] && COMPOSE_FILE="docker-compose.no-nginx.yml"

info "Construiesc imagini (prima rulare ~3 min)..."
docker compose -f "$COMPOSE_FILE" up -d --build

info "Aștept API + migrări..."
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:8000/health 2>/dev/null || echo "000")
  [[ "$code" == "200" ]] && break
  sleep 3
done
[[ "$code" != "200" ]] && warn "API nu a răspuns în 3 min — verifică: docker compose -f $COMPOSE_FILE logs api"

# ── Succes ────────────────────────────────────────────────
[[ "$MODE" == "prod-direct" ]] && DASHBOARD_URL="${SCHEME}://${DOMAIN}" || DASHBOARD_URL="${SCHEME}://${DOMAIN}"

echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  PeerDesk instalat cu succes!${NC}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Dashboard  →  ${BLUE}${BOLD}${DASHBOARD_URL}${NC}"
if [[ "$MODE" == "prod-direct" ]]; then
  echo -e "  API        →  ${SCHEME}://${DOMAIN}:8000"
  echo -e "  Signaling  →  ${WS_SCHEME}://${DOMAIN}:8001/ws"
fi
echo ""
echo "  Pași următori:"
echo "    1. Deschide dashboard-ul și creează-ți contul"
echo "    2. Instalează agentul pe mașinile de controlat:"
echo ""
echo -e "       ${BOLD}PEERDESK_PASSWORD=<parola> \\"
echo -e "       SIGNALING_URL=${WS_SCHEME}://${DOMAIN}/ws \\"
echo -e "       ./peerdesk-agent${NC}"
echo ""
echo "  Actualizare ulterioară:"
echo "    cd ${SCRIPT_DIR} && bash install.sh"
echo ""
echo "  Gestiune:"
echo "    docker compose -f ${SCRIPT_DIR}/${COMPOSE_FILE} ps"
echo "    docker compose -f ${SCRIPT_DIR}/${COMPOSE_FILE} logs -f"
echo "    docker compose -f ${SCRIPT_DIR}/${COMPOSE_FILE} down"
echo ""
echo "  Config:   ${SCRIPT_DIR}/config.json"
echo "  Secrete:  ${SCRIPT_DIR}/.env"
echo ""
