#!/usr/bin/env bash
# PeerDesk installer — run from deploy/
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

# ── CLI arguments (optional, for scripting/CI) ────────
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
  warn "Docker is not installed."
  ask "Install automatically? [Y/n]: "
  read -r ans
  [[ "${ans:-Y}" =~ ^[Yy]$ ]] || error "Install Docker from https://docs.docker.com/get-docker/"
  info "Installing Docker..."
  curl -fsSL https://get.docker.com | sh
  info "Docker installed."
fi
docker compose version &>/dev/null || error "Docker Compose v2 missing. Update Docker."
info "Docker $(docker --version | grep -oP '\d+\.\d+\.\d+' | head -1) — OK"

# ── Deployment mode ────────────────────────────────────────
step "Deployment mode"

if [[ -z "$MODE" ]]; then
  echo ""
  echo "  1) Dev (local)         — hot reload, everything in Docker, port :5173"
  echo "  2) Production + nginx  — internal nginx, optional SSL, port :80/:443"
  echo "  3) Production direct   — direct ports, external proxy (Traefik/Caddy)"
  echo ""
  ask "Choose [1/2/3]: "
  read -r choice
  case "${choice:-1}" in
    1) MODE="dev" ;;
    2) MODE="prod-nginx" ;;
    3) MODE="prod-direct" ;;
    *) error "Invalid option." ;;
  esac
fi

# ─────────────────────────────────────────────────────────
# DEV MODE
# ─────────────────────────────────────────────────────────
if [[ "$MODE" == "dev" ]]; then
  step "Starting dev stack"
  info "Building images and starting (first run ~2 min)..."
  docker compose -f docker-compose.dev.yml up -d --build

  info "Waiting for services..."
  for i in $(seq 1 40); do
    code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 http://localhost:8000/health 2>/dev/null || echo "000")
    [[ "$code" == "200" ]] && break
    sleep 2
  done

  echo ""
  echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo -e "${GREEN}${BOLD}  Dev stack started!${NC}"
  echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
  echo ""

  # Detect the IP for access from another machine
  LOCAL_IP=$(ip route get 1.1.1.1 2>/dev/null | grep -oP 'src \K[\d.]+' || echo "localhost")
  echo -e "  Browser  →  ${BLUE}${BOLD}http://localhost:5173${NC}"
  [[ "$LOCAL_IP" != "localhost" ]] && \
    echo -e "  Network  →  ${BLUE}http://${LOCAL_IP}:5173${NC}"
  echo ""
  echo "  Code changes are reloaded automatically."
  echo ""
  echo "  Logs:  docker compose -f docker-compose.dev.yml logs -f"
  echo "  Stop:  docker compose -f docker-compose.dev.yml down"
  echo ""
  exit 0
fi

# ─────────────────────────────────────────────────────────
# PROD MODE — collect config
# ─────────────────────────────────────────────────────────
step "Configuration"

if [[ -z "$DOMAIN" ]]; then
  ask "Server domain or IP (e.g. peerdesk.example.com or 192.168.1.10): "
  read -r DOMAIN
  [[ -z "$DOMAIN" ]] && error "Domain/IP required."
fi

if [[ "$MODE" == "prod-nginx" && "$USE_TLS" == "n" ]]; then
  ask "Enable HTTPS with Let's Encrypt? (requires DNS configured) [y/N]: "
  read -r tls_ans
  USE_TLS="${tls_ans:-n}"
fi

if [[ "$USE_TLS" =~ ^[Yy]$ && -z "$ADMIN_EMAIL" ]]; then
  ask "Email for SSL certificate: "
  read -r ADMIN_EMAIL
  [[ -z "$ADMIN_EMAIL" ]] && error "Email required for Let's Encrypt."
fi

[[ "$USE_TLS" =~ ^[Yy]$ ]] && SCHEME="https" && WS_SCHEME="wss" || SCHEME="http" && WS_SCHEME="ws"

# ── .env ──────────────────────────────────────────────────
step "Credentials"

if [[ -f .env ]]; then
  warn ".env exists — keeping the secrets. Delete .env to regenerate."
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

  info "Created .env with random secrets:"
  info "  DB password:   ${PG_PASS:0:8}…"
  info "  JWT secret:    ${JWT_SEC:0:8}…"
  info "  TURN secret:   ${TURN_SEC:0:8}…"
  set -a; source .env; set +a
fi

# ── config.json ───────────────────────────────────────────
step "config.json"

if [[ "$MODE" == "prod-nginx" ]]; then
  # nginx on the same domain → relative paths
  cat > config.json << 'EOF'
{
  "apiUrl": "/api",
  "signalingUrl": "/ws"
}
EOF
  info "config.json: relative paths (internal nginx proxy)"
else
  # No nginx → absolute URLs with port
  cat > config.json << EOF
{
  "apiUrl": "${SCHEME}://${DOMAIN}:8000",
  "signalingUrl": "${WS_SCHEME}://${DOMAIN}:8001/ws"
}
EOF
  info "config.json: direct URLs (${SCHEME}://${DOMAIN}:8000)"
fi

# ── TLS ───────────────────────────────────────────────────
if [[ "$USE_TLS" =~ ^[Yy]$ ]]; then
  step "SSL certificates"

  if ! command -v certbot &>/dev/null; then
    info "Installing certbot..."
    if   command -v apt-get &>/dev/null; then apt-get install -y certbot
    elif command -v dnf     &>/dev/null; then dnf install -y certbot
    else error "Install certbot manually and re-run."; fi
  fi

  certbot certonly --standalone -d "$DOMAIN" \
    --agree-tos --non-interactive --email "$ADMIN_EMAIL"

  mkdir -p nginx/certs
  cp /etc/letsencrypt/live/"$DOMAIN"/fullchain.pem nginx/certs/cert.pem
  cp /etc/letsencrypt/live/"$DOMAIN"/privkey.pem   nginx/certs/key.pem
  chmod 600 nginx/certs/key.pem
  info "Certificates copied to nginx/certs/"

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
  info "nginx configured for HTTPS + HTTP→HTTPS redirect"
fi

# ── Build and start ──────────────────────────────────────
step "Build and start"

COMPOSE_FILE="docker-compose.yml"
[[ "$MODE" == "prod-direct" ]] && COMPOSE_FILE="docker-compose.no-nginx.yml"

info "Building images (first run ~3 min)..."
docker compose -f "$COMPOSE_FILE" up -d --build

info "Waiting for API + migrations..."
for i in $(seq 1 60); do
  code=$(curl -s -o /dev/null -w "%{http_code}" --max-time 3 http://localhost:8000/health 2>/dev/null || echo "000")
  [[ "$code" == "200" ]] && break
  sleep 3
done
[[ "$code" != "200" ]] && warn "API did not respond within 3 min — check: docker compose -f $COMPOSE_FILE logs api"

# ── Success ────────────────────────────────────────────────
[[ "$MODE" == "prod-direct" ]] && DASHBOARD_URL="${SCHEME}://${DOMAIN}" || DASHBOARD_URL="${SCHEME}://${DOMAIN}"

echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  PeerDesk installed successfully!${NC}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
echo -e "  Dashboard  →  ${BLUE}${BOLD}${DASHBOARD_URL}${NC}"
if [[ "$MODE" == "prod-direct" ]]; then
  echo -e "  API        →  ${SCHEME}://${DOMAIN}:8000"
  echo -e "  Signaling  →  ${WS_SCHEME}://${DOMAIN}:8001/ws"
fi
echo ""
echo "  Next steps:"
echo "    1. Open the dashboard and create your account"
echo "    2. Install the agent on the machines to control:"
echo ""
echo -e "       ${BOLD}PEERDESK_PASSWORD=<password> \\"
echo -e "       SIGNALING_URL=${WS_SCHEME}://${DOMAIN}/ws \\"
echo -e "       ./peerdesk-agent${NC}"
echo ""
echo "  Later updates:"
echo "    cd ${SCRIPT_DIR} && bash install.sh"
echo ""
echo "  Management:"
echo "    docker compose -f ${SCRIPT_DIR}/${COMPOSE_FILE} ps"
echo "    docker compose -f ${SCRIPT_DIR}/${COMPOSE_FILE} logs -f"
echo "    docker compose -f ${SCRIPT_DIR}/${COMPOSE_FILE} down"
echo ""
echo "  Config:   ${SCRIPT_DIR}/config.json"
echo "  Secrets:  ${SCRIPT_DIR}/.env"
echo ""
