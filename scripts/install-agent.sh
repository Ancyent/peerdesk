#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; YELLOW='\033[1;33m'; BLUE='\033[0;34m'; BOLD='\033[1m'; NC='\033[0m'
info()  { echo -e "${GREEN}[INFO]${NC}  $*"; }
warn()  { echo -e "${YELLOW}[WARN]${NC}  $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }
ask()   { echo -e "${BLUE}[INPUT]${NC} $*"; }

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo ""
echo -e "${BOLD}PeerDesk Agent Installer${NC}"
echo "Installs the PeerDesk agent as a systemd service for unattended access."
echo ""

# ── Require root ──────────────────────────────────────────
[[ "$(id -u)" -eq 0 ]] || error "Run as root: sudo bash $0 [binary_path]"

# ── Find binary ───────────────────────────────────────────
BINARY_PATH="${1:-}"
if [[ -z "$BINARY_PATH" ]]; then
    # Try common locations
    for candidate in \
        "$SCRIPT_DIR/../target/release/peerdesk-agent" \
        "/usr/local/bin/peerdesk-agent" \
        "./peerdesk-agent"; do
        if [[ -f "$candidate" ]]; then
            BINARY_PATH="$candidate"
            break
        fi
    done
fi
[[ -n "$BINARY_PATH" && -f "$BINARY_PATH" ]] || \
    error "Agent binary not found. Build with: cargo build -p peerdesk-agent --release\nThen run: sudo bash $0 ./target/release/peerdesk-agent"

info "Using binary: $BINARY_PATH"

# ── Collect config ────────────────────────────────────────
echo ""
ask "PeerDesk server URL (e.g. https://peerdesk.example.com or http://192.168.1.10):"
read -r SERVER_URL
[[ -z "$SERVER_URL" ]] && error "Server URL is required."
SERVER_URL="${SERVER_URL%/}"

# Derive WebSocket URL from HTTP URL
WS_URL="${SERVER_URL/https:/wss:}/ws"
WS_URL="${WS_URL/http:/ws:}"

echo ""
ask "Agent password (users will enter this to connect to this machine):"
read -rs AGENT_PASSWORD
echo ""
[[ -z "$AGENT_PASSWORD" ]] && error "Password is required."

echo ""
ask "API token (from PeerDesk dashboard → Settings → API tokens). Leave blank to skip:"
read -r API_TOKEN

# ── Create system user ────────────────────────────────────
if ! id peerdesk &>/dev/null; then
    useradd --system --no-create-home --shell /bin/false peerdesk
    info "Created system user: peerdesk"
else
    info "System user 'peerdesk' already exists"
fi

# ── Create data directory ─────────────────────────────────
mkdir -p /var/lib/peerdesk
chown peerdesk:peerdesk /var/lib/peerdesk
chmod 700 /var/lib/peerdesk
info "Data directory: /var/lib/peerdesk"

# ── Install binary ────────────────────────────────────────
install -o root -g root -m 755 "$BINARY_PATH" /usr/local/bin/peerdesk-agent
info "Installed binary: /usr/local/bin/peerdesk-agent"

# ── Write environment file ────────────────────────────────
cat > /etc/peerdesk-agent.env << EOF
PEERDESK_PASSWORD=${AGENT_PASSWORD}
SIGNALING_URL=${WS_URL}
API_URL=${SERVER_URL}/api
API_TOKEN=${API_TOKEN}
XDG_CONFIG_HOME=/var/lib/peerdesk
EOF
chmod 600 /etc/peerdesk-agent.env
chown root:root /etc/peerdesk-agent.env
info "Environment file: /etc/peerdesk-agent.env (mode 600)"

# ── Write systemd unit ────────────────────────────────────
cat > /etc/systemd/system/peerdesk-agent.service << 'UNITEOF'
[Unit]
Description=PeerDesk Remote Desktop Agent
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=peerdesk
Group=peerdesk
EnvironmentFile=/etc/peerdesk-agent.env
ExecStart=/usr/local/bin/peerdesk-agent
Restart=always
RestartSec=10
TimeoutStopSec=10
StandardOutput=journal
StandardError=journal
SyslogIdentifier=peerdesk-agent
NoNewPrivileges=yes
PrivateTmp=yes

[Install]
WantedBy=multi-user.target
UNITEOF

info "Systemd unit: /etc/systemd/system/peerdesk-agent.service"

# ── Enable and start ──────────────────────────────────────
systemctl daemon-reload
systemctl enable peerdesk-agent
systemctl restart peerdesk-agent

sleep 3
if systemctl is-active --quiet peerdesk-agent; then
    info "PeerDesk agent is running."
else
    warn "Agent may not have started yet. Check: journalctl -u peerdesk-agent -n 20"
fi

# ── Try to get peer ID from logs ──────────────────────────
PEER_ID=""
for _ in $(seq 1 5); do
    PEER_ID=$(journalctl -u peerdesk-agent --since "30 seconds ago" --no-pager -n 20 2>/dev/null \
              | grep -oP 'peer_id=\K[0-9]+' | head -1 || true)
    [[ -n "$PEER_ID" ]] && break
    sleep 1
done

echo ""
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo -e "${GREEN}${BOLD}  PeerDesk agent installed successfully!${NC}"
echo -e "${GREEN}${BOLD}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}"
echo ""
[[ -n "$PEER_ID" ]] && echo -e "  Peer ID: ${BOLD}${PEER_ID}${NC}"
echo ""
echo "  Open the PeerDesk dashboard at:"
echo "    ${SERVER_URL}"
echo ""
echo "  Manage:"
echo "    systemctl {start|stop|restart|status} peerdesk-agent"
echo "    journalctl -u peerdesk-agent -f"
echo ""
