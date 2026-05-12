#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'; NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC} $*"; }

cd "$(dirname "$0")/.."

info "Cross-compiling PeerDesk agent for Windows x86_64..."

# Add Windows target if not present
rustup target add x86_64-pc-windows-gnu 2>/dev/null || true

# Install mingw if not present
if ! command -v x86_64-w64-mingw32-gcc &>/dev/null; then
  info "Installing mingw-w64..."
  apt-get install -y gcc-mingw-w64-x86-64 2>/dev/null || \
  dnf install -y mingw64-gcc 2>/dev/null || \
  true
fi

source ~/.cargo/env

info "Building..."
cargo build -p peerdesk-agent --target x86_64-pc-windows-gnu --release

echo ""
echo "Output: target/x86_64-pc-windows-gnu/release/peerdesk-agent.exe"
ls -lh target/x86_64-pc-windows-gnu/release/peerdesk-agent.exe 2>/dev/null || true
