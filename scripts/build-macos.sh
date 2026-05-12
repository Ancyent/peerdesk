#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'; BOLD='\033[1m'; NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC} $*"; }

cd "$(dirname "$0")/.."

info "Building PeerDesk for macOS (Universal: Intel + Apple Silicon)..."

# Add Apple Silicon target
rustup target add aarch64-apple-darwin 2>/dev/null || true

# Install Tauri CLI if needed
if ! cargo tauri --version &>/dev/null 2>&1; then
  cargo install tauri-cli --version "^2" --locked
fi

cd desktop
npm ci --silent
npm run build

cargo tauri build --target universal-apple-darwin

echo ""
echo -e "${BOLD}Build complete!${NC}"
find src-tauri/target/universal-apple-darwin/release/bundle -name "*.dmg" 2>/dev/null | while read f; do
  size=$(du -sh "$f" | cut -f1)
  echo "  $size  $f"
done
