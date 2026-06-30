#!/usr/bin/env bash
# PeerDesk Agent — Linux installer
# Usage:
#   curl -sSL https://raw.githubusercontent.com/Ancyent/peerdesk/main/scripts/deploy/install.sh \
#     | sudo bash -s -- --server=https://api.example.com --token=YOUR_TOKEN

set -euo pipefail

GITHUB_REPO="Ancyent/peerdesk"
INSTALL_DIR="/usr/local/bin"
BINARY_NAME="peerdesk-agent"

TOKEN=""
SERVER=""

for arg in "$@"; do
  case $arg in
    --token=*)  TOKEN="${arg#*=}" ;;
    --server=*) SERVER="${arg#*=}" ;;
    *) echo "Unknown argument: $arg"; exit 1 ;;
  esac
done

if [[ $EUID -ne 0 ]]; then
  echo "Run as root: sudo bash $0 $*"
  exit 1
fi

echo "==> Fetching latest PeerDesk release..."
DOWNLOAD_URL=$(curl -sSL "https://api.github.com/repos/${GITHUB_REPO}/releases/latest" \
  | grep '"browser_download_url"' \
  | grep 'linux-x86_64' \
  | cut -d '"' -f 4)

if [[ -z "$DOWNLOAD_URL" ]]; then
  echo "ERROR: Could not find Linux binary in latest release."
  exit 1
fi

echo "==> Downloading ${DOWNLOAD_URL}..."
curl -sSL "$DOWNLOAD_URL" -o "${INSTALL_DIR}/${BINARY_NAME}"
chmod +x "${INSTALL_DIR}/${BINARY_NAME}"
echo "==> Installed to ${INSTALL_DIR}/${BINARY_NAME}"

ARGS=""
[[ -n "$SERVER" ]] && ARGS="$ARGS --server=$SERVER"
[[ -n "$TOKEN"  ]] && ARGS="$ARGS --token=$TOKEN"

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
