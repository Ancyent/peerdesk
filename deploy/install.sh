#!/usr/bin/env bash
set -euo pipefail

# ── Colors ──────────────────────────────────────────────
RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info()   { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()   { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error()  { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
ask()    { echo -e "${BLUE}[INPUT]${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# ── Banner ───────────────────────────────────────────────
echo -e "${BOLD}"
cat << 'BANNER'
  ____                 ____            _
 |  _ \ ___  ___ _ __|  _ \  ___  ___| | __
 | |_) / _ \/ _ \ '__| | | |/ _ \/ __| |/ /
 |  __/  __/  __/ |  | |_| |  __/\__ \   <
 |_|   \___|\___|_|  |____/ \___||___/_|\_\

  Self-Hosted Installer
BANNER
echo -e "${NC}"

# ── Check Docker ─────────────────────────────────────────
check_docker() {
    if ! command -v docker &>/dev/null; then
        warn "Docker is not installed."
        ask "Install Docker automatically? [Y/n]: "
        read -r ans
        if [[ "${ans:-Y}" =~ ^[Yy]$ ]]; then
            info "Installing Docker..."
            curl -fsSL https://get.docker.com | sh
            info "Docker installed successfully."
        else
            error "Docker is required. Install it from https://docs.docker.com/get-docker/ and re-run."
        fi
    fi

    if ! docker compose version &>/dev/null 2>&1; then
        error "Docker Compose v2 is required. Update Docker Desktop or install the compose plugin."
    fi

    info "Docker $(docker --version | grep -oP '\d+\.\d+\.\d+')"
    info "Docker Compose $(docker compose version --short 2>/dev/null || docker compose version | grep -oP '\d+\.\d+\.\d+')"
}

# ── Collect config from user ─────────────────────────────
DOMAIN=""
USE_TLS="N"
ADMIN_EMAIL=""

collect_config() {
    echo ""
    ask "Domain name or server IP (e.g. peerdesk.example.com or 192.168.1.10):"
    read -r DOMAIN
    [[ -z "$DOMAIN" ]] && error "Domain or IP is required."

    echo ""
    ask "Enable HTTPS with Let's Encrypt? Requires a real domain with DNS pointing here. [y/N]: "
    read -r USE_TLS
    USE_TLS="${USE_TLS:-N}"

    if [[ "$USE_TLS" =~ ^[Yy]$ ]]; then
        ask "Admin email for Let's Encrypt certificate notifications: "
        read -r ADMIN_EMAIL
        [[ -z "$ADMIN_EMAIL" ]] && error "Email is required for Let's Encrypt."
    fi
}

# ── Generate .env ────────────────────────────────────────
generate_env() {
    if [[ -f .env ]]; then
        warn ".env already exists — skipping generation. Delete it to regenerate secrets."
        # Source existing .env so we have the vars for URL setup
        # shellcheck disable=SC1091
        set -a; source .env; set +a
        return
    fi

    local pg_pass jwt_secret scheme ws_scheme
    pg_pass=$(openssl rand -hex 24)
    jwt_secret=$(openssl rand -hex 32)

    if [[ "$USE_TLS" =~ ^[Yy]$ ]]; then
        scheme="https"; ws_scheme="wss"
    else
        scheme="http"; ws_scheme="ws"
    fi

    cat > .env << EOF
POSTGRES_USER=peerdesk
POSTGRES_PASSWORD=${pg_pass}
POSTGRES_DB=peerdesk
JWT_SECRET=${jwt_secret}
VITE_SIGNALING_URL=${ws_scheme}://${DOMAIN}/ws
VITE_API_URL=${scheme}://${DOMAIN}/api
EOF

    info ".env generated with random secrets."
    info "  DB password: ${pg_pass:0:8}... (full value in .env)"
    info "  JWT secret:  ${jwt_secret:0:8}... (full value in .env)"

    # Export for use below
    # shellcheck disable=SC1091
    set -a; source .env; set +a
}

# ── TLS via Let's Encrypt ─────────────────────────────────
setup_tls() {
    [[ ! "$USE_TLS" =~ ^[Yy]$ ]] && return

    info "Obtaining TLS certificate for ${DOMAIN}..."

    if ! command -v certbot &>/dev/null; then
        info "Installing certbot..."
        if command -v apt-get &>/dev/null; then
            apt-get install -y certbot
        elif command -v yum &>/dev/null; then
            yum install -y certbot
        elif command -v dnf &>/dev/null; then
            dnf install -y certbot
        else
            error "Cannot auto-install certbot. Install it manually then re-run."
        fi
    fi

    # Stop any service on port 80 temporarily so certbot can bind
    certbot certonly --standalone -d "$DOMAIN" \
        --agree-tos --non-interactive --email "$ADMIN_EMAIL"

    mkdir -p nginx/certs
    cp /etc/letsencrypt/live/"$DOMAIN"/fullchain.pem nginx/certs/cert.pem
    cp /etc/letsencrypt/live/"$DOMAIN"/privkey.pem   nginx/certs/key.pem
    chmod 600 nginx/certs/key.pem

    # Overwrite nginx config with HTTPS version
    cat > nginx/default.conf << 'NGINXEOF'
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

    location /ws {
        proxy_pass http://signaling:8001;
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
        proxy_pass http://api:8000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location / {
        proxy_pass http://web:80;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
NGINXEOF
    info "TLS configured. nginx will redirect HTTP→HTTPS."
}

# ── Start stack ──────────────────────────────────────────
start_stack() {
    info "Building images and starting PeerDesk stack..."
    docker compose -f docker-compose.yml up -d --build

    info "Waiting for database to be ready..."
    local retries=30
    until docker compose -f docker-compose.yml exec -T postgres \
            pg_isready -U "${POSTGRES_USER:-peerdesk}" &>/dev/null; do
        retries=$((retries - 1))
        [[ $retries -le 0 ]] && error "Database did not become ready within 60 seconds."
        sleep 2
    done
    info "Database is ready."

    info "Running database migrations..."
    docker compose -f docker-compose.yml exec -T api alembic upgrade head
    info "Migrations complete."
}

# ── Print success ─────────────────────────────────────────
print_success() {
    local scheme="http"
    [[ "$USE_TLS" =~ ^[Yy]$ ]] && scheme="https"
    local url="${scheme}://${DOMAIN}"

    echo ""
    echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo -e "${GREEN}${BOLD}  PeerDesk installed successfully!${NC}"
    echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
    echo ""
    echo -e "  Dashboard  →  ${BLUE}${BOLD}${url}${NC}"
    echo ""
    echo "  Next steps:"
    echo "    1. Open the dashboard and create your account"
    echo "    2. Copy your API token from account settings"
    echo "    3. On machines you want to control, run the PeerDesk agent:"
    echo ""
    echo -e "       ${BOLD}PEERDESK_PASSWORD=<pass> API_URL=${url} API_TOKEN=<token> \\"
    echo -e "         ./peerdesk-agent${NC}"
    echo ""
    echo "  Stack management:"
    echo "    cd ${SCRIPT_DIR}"
    echo "    docker compose -f docker-compose.yml ps"
    echo "    docker compose -f docker-compose.yml logs -f"
    echo "    docker compose -f docker-compose.yml down"
    echo ""
}

# ── Main ─────────────────────────────────────────────────
main() {
    check_docker
    collect_config
    generate_env
    setup_tls
    start_stack
    print_success
}

main "$@"
