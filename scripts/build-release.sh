#!/usr/bin/env bash
# Build agent binaries locally → builds/{version}/
# Usage: ./scripts/build-release.sh [version]
#   version defaults to the latest git tag (e.g. v0.1.8)
#
# Platforms:
#   Linux x86_64  — compiled natively, works directly
#   Windows x86_64 — requires a Windows runner (GitHub CI) due to native C deps
#   Android aarch64 — optional, requires ANDROID_NDK_HOME set

set -euo pipefail

VERSION="${1:-$(git describe --tags --abbrev=0 2>/dev/null || echo "dev")}"
OUT="builds/${VERSION}"

echo "==> Building peerdesk-agent ${VERSION}"
echo "==> Output: ${OUT}/"
mkdir -p "${OUT}"

# ── Linux x86_64 (native) ──────────────────────────────────────────────────────
echo ""
echo "[1/2] Linux x86_64..."
cargo build -p peerdesk-agent --release
cp target/release/peerdesk-agent "${OUT}/peerdesk-agent-linux-x86_64"
echo "      ✓ ${OUT}/peerdesk-agent-linux-x86_64 ($(du -sh "${OUT}/peerdesk-agent-linux-x86_64" | cut -f1))"
echo "      Peer ID: $(./${OUT}/peerdesk-agent-linux-x86_64 --get-id)"

# ── Android aarch64 (optional, requires NDK) ──────────────────────────────────
echo ""
echo "[2/2] Android aarch64..."
NDK="${ANDROID_NDK_HOME:-${NDK_HOME:-}}"
if [ -z "${NDK}" ]; then
  echo "      ⚠  Skipped — set ANDROID_NDK_HOME for Android build"
  echo "         Setup: wget .../android-ndk-r27c-linux.zip && export ANDROID_NDK_HOME=/opt/android-ndk-r27c"
else
  echo "      NDK: ${NDK}"
  mkdir -p "${OUT}/android"
  cargo ndk -t aarch64-linux-android -o "${OUT}/android/" \
    build -p peerdesk-agent --release
  SO="${OUT}/android/arm64-v8a/libpeerdesk_agent.so"
  echo "      ✓ ${SO} ($(du -sh "${SO}" | cut -f1))"
fi

# ── Summary ───────────────────────────────────────────────────────────────────
echo ""
echo "==> Artifacts in ${OUT}/:"
find "${OUT}" -type f | sort | while read -r f; do
  printf "      %-8s %s\n" "$(du -sh "$f" | cut -f1)" "$f"
done
echo ""
echo "    Windows x86_64: build via GitHub CI (tag + release) or on a Windows machine"
