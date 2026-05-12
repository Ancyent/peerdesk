#!/usr/bin/env bash
set -euo pipefail

GREEN='\033[0;32m'; BOLD='\033[1m'; NC='\033[0m'
info() { echo -e "${GREEN}[INFO]${NC} $*"; }

cd "$(dirname "$0")/.."

export ANDROID_HOME="${ANDROID_HOME:-$HOME/android-sdk}"
export NDK_HOME="${NDK_HOME:-$ANDROID_HOME/ndk/26.1.10909125}"
export PATH="$PATH:$ANDROID_HOME/cmdline-tools/latest/bin:$ANDROID_HOME/platform-tools"

command -v java &>/dev/null || { echo "Java not found. Install: sudo apt-get install openjdk-17-jdk"; exit 1; }
[[ -d "$ANDROID_HOME" ]] || { echo "Android SDK not found at $ANDROID_HOME. Run scripts/setup-android.sh first."; exit 1; }

source ~/.cargo/env
source ~/.nvm/nvm.sh && nvm use 20

info "Building PeerDesk for Android..."
cd desktop
npm ci --silent
npm run build

cargo tauri android build --apk

echo ""
echo -e "${BOLD}Build complete!${NC}"
find src-tauri/gen/android -name "*.apk" 2>/dev/null | while read f; do
  size=$(du -sh "$f" | cut -f1)
  echo "  $size  $f"
done
