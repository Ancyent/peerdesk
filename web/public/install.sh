#!/usr/bin/env bash
# PeerDesk Agent — Linux installer
# Usage:
#   curl -sSL https://raw.githubusercontent.com/Ancyent/peerdesk/main/scripts/deploy/install.sh \
#     | sudo bash -s -- --server=https://api.example.com --api-key=YOUR_TOKEN

set -euo pipefail

GITHUB_REPO="Ancyent/peerdesk"
INSTALL_DIR="/usr/local/bin"
BINARY_NAME="peerdesk-agent"

API_KEY=""
SERVER=""
HEADLESS=0

for arg in "$@"; do
  case $arg in
    --api-key=*) API_KEY="${arg#*=}" ;;
    --server=*)  SERVER="${arg#*=}" ;;
    --headless)  HEADLESS=1 ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash $0 $*"
  exit 1
fi

echo "==> Fetching latest PeerDesk release..."
ASSET_URLS=$(curl -sSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" \
  | grep '"browser_download_url"' \
  | cut -d '"' -f 4 \
  | grep 'peerdesk-agent-linux-x86_64')

if [[ "$HEADLESS" -eq 1 ]]; then
  DOWNLOAD_URL=$(echo "$ASSET_URLS" | grep 'headless' | head -1)
else
  DOWNLOAD_URL=$(echo "$ASSET_URLS" | grep -v 'headless' | head -1)
fi

if [[ -z "$DOWNLOAD_URL" ]]; then
  echo "ERROR: Could not find Linux agent binary in latest release."
  exit 1
fi

echo "==> Downloading ${DOWNLOAD_URL}..."
curl -sSL "$DOWNLOAD_URL" -o "${INSTALL_DIR}/${BINARY_NAME}"
chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
echo "==> Installed to ${INSTALL_DIR}/${BINARY_NAME}"

ARGS=""
[[ -n "$SERVER"  ]] && ARGS="$ARGS --server=$SERVER"
[[ -n "$API_KEY" ]] && ARGS="$ARGS --api-key=$API_KEY"

echo "==> Installing systemd service..."
# shellcheck disable=SC2086
"${INSTALL_DIR}/${BINARY_NAME}" --install-service $ARGS

PEER_ID=$("${INSTALL_DIR}/${BINARY_NAME}" --get-id 2>/dev/null || echo "unknown")

echo ""
echo "==============================================="
echo " PeerDesk Agent installed successfully!"
echo " Peer ID : ${PEER_ID}"
echo " Service : systemctl status peerdesk-agent"
echo " Logs    : journalctl -u peerdesk-agent -f"
echo "==============================================="
