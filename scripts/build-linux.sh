#!/usr/bin/env bash
set -euo pipefail

RED='\033[0;31m'; GREEN='\033[0;32m'; BOLD='\033[1m'; NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC} $*"; }
error() { echo -e "${RED}[ERROR]${NC} $*" >&2; exit 1; }

cd "$(dirname "$0")/.."

info "Building PeerDesk for Linux (.deb + .AppImage)..."

# Check deps
command -v cargo &>/dev/null || error "Rust/cargo not found. Install: https://rustup.rs"
command -v node &>/dev/null || error "Node.js not found. Install: https://nodejs.org"

# Install Tauri CLI if needed
if ! cargo tauri --version &>/dev/null 2>&1; then
  info "Installing tauri-cli..."
  cargo install tauri-cli --version "^2" --locked
fi

# Build frontend
info "Building frontend..."
cd desktop
npm ci --silent
npm run build

# Build Tauri app
info "Building Tauri app..."
cargo tauri build

echo ""
echo -e "${BOLD}Build complete!${NC}"
echo ""
echo "Packages:"
find src-tauri/target/release/bundle -name "*.deb" -o -name "*.AppImage" 2>/dev/null | while read f; do
  size=$(du -sh "$f" | cut -f1)
  echo "  $size  $f"
done
