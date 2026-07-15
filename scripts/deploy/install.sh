#!/usr/bin/env bash
# PeerDesk Agent — Linux installer
# Usage:
#   curl -sSL https://raw.githubusercontent.com/Ancyent/peerdesk/main/scripts/deploy/install.sh \
#     | sudo bash -s -- --server=https://api.example.com --api-key=YOUR_TOKEN

set -euo pipefail

INSTALL_DIR="/usr/local/bin"
BINARY_NAME="peerdesk-agent"

API_KEY=""
SERVER=""
PASSWORD=""
HEADLESS=0
GUI=0

for arg in "$@"; do
  case $arg in
    --api-key=*)  API_KEY="${arg#*=}" ;;
    --server=*)   SERVER="${arg#*=}" ;;
    --password=*) PASSWORD="${arg#*=}" ;;
    --headless)   HEADLESS=1 ;;
    --gui)        GUI=1 ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

# Auto-detect GUI vs headless when neither flag is given.
# The full agent links libxdo/pipewire/X11 and won't even load on a headless box.
if [[ "$HEADLESS" -eq 0 && "$GUI" -eq 0 ]]; then
  if [[ -n "${DISPLAY:-}" || -n "${WAYLAND_DISPLAY:-}" ]] || compgen -G "/tmp/.X11-unix/X*" >/dev/null 2>&1; then
    : # graphical session present -> keep the full GUI-capture agent
  else
    HEADLESS=1
    echo "==> No graphical session detected -> installing the headless agent (terminal mode)."
    echo "    Pass --gui to force the full GUI-capture agent instead."
  fi
fi

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash $0 $*"
  exit 1
fi

# Resolve the agent binary from the PeerDesk server, never from the GitHub API:
# GitHub allows 60 requests/hour per source IP (shared by every machine behind
# your NAT) and is unreachable from isolated networks. The server mirrors each
# release and serves it itself.
resolve_download_url() {
  local manifest asset
  if [[ -z "$SERVER" ]]; then
    echo "ERROR: --server=<url> is required to resolve the agent binary (e.g. --server=https://api.example.com)" >&2
    exit 1
  fi
  manifest=$(curl -sSL "${SERVER}/api/releases/latest") || {
    echo "ERROR: cannot reach ${SERVER}/api/releases/latest" >&2
    exit 1
  }
  if [[ "$HEADLESS" -eq 1 ]]; then
    asset=$(echo "$manifest" | grep -o '"name": *"[^"]*headless[^"]*"' | head -1 | cut -d '"' -f 4)
  else
    asset=$(echo "$manifest" | grep -o '"name": *"peerdesk-agent-linux-x86_64-v[^"]*"' | head -1 | cut -d '"' -f 4)
  fi
  if [[ -z "$asset" ]]; then
    echo "ERROR: no Linux agent binary in ${SERVER}/api/releases/latest" >&2
    echo "       The server may not have fetched a release yet." >&2
    exit 1
  fi
  DOWNLOAD_URL="${SERVER}/api/releases/download/${asset}"
}

echo "==> Resolving agent binary from ${SERVER}..."
resolve_download_url

echo "==> Downloading ${DOWNLOAD_URL}..."
curl -sSL "$DOWNLOAD_URL" -o "${INSTALL_DIR}/${BINARY_NAME}"
chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
echo "==> Installed to ${INSTALL_DIR}/${BINARY_NAME}"

# The agent auto-approves connections for headless installs, so the access
# password is the only gate. Generate one if the caller didn't pass --password,
# and print it below so the machine is actually reachable.
GENERATED_PW=0
if [[ -z "$PASSWORD" ]]; then
  PASSWORD="$( { LC_ALL=C tr -dc 'a-zA-Z0-9' < /dev/urandom | head -c 14; } 2>/dev/null || true )"
  GENERATED_PW=1
fi

ARGS=""
[[ -n "$SERVER"   ]] && ARGS="$ARGS --server=$SERVER"
[[ -n "$API_KEY"  ]] && ARGS="$ARGS --api-key=$API_KEY"
[[ -n "$PASSWORD" ]] && ARGS="$ARGS --password=$PASSWORD"

echo "==> Installing systemd service..."
# shellcheck disable=SC2086
"${INSTALL_DIR}/${BINARY_NAME}" --install-service $ARGS

PEER_ID=$("${INSTALL_DIR}/${BINARY_NAME}" --get-id 2>/dev/null || echo "unknown")

echo ""
echo "==============================================="
echo " PeerDesk Agent installed successfully!"
echo " Peer ID : ${PEER_ID}"
echo " Password: ${PASSWORD}"
echo " Service : systemctl status peerdesk-agent"
echo " Logs    : journalctl -u peerdesk-agent -f"
echo "==============================================="
if [[ "$GENERATED_PW" -eq 1 ]]; then
  echo " NOTE: password auto-generated — save it. Connect with Peer ID + Password."
  echo "       Pass --password=YOUR_PW to choose your own, or run:"
  echo "       sudo ${BINARY_NAME} --reset-password  (to rotate it later)"
fi
