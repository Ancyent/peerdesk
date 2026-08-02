#!/usr/bin/env bash
# Build every Linux and Windows client and place them in the release cache.
#
# The cache is what server/api/release_cache.py serves, so once this finishes
# the Downloads page, install.sh and the updater all offer these artifacts with
# no code change anywhere.
set -euo pipefail

VERSION="${VERSION:?VERSION must be set, e.g. VERSION=v1.2.3}"
CACHE_DIR="${CACHE_DIR:-/var/lib/peerdesk/releases}"
KEY="${UPDATER_KEY_PATH:?UPDATER_KEY_PATH must be set}"
: "${UPDATER_KEY_PASSWORD:?UPDATER_KEY_PASSWORD must be set}"

# Signing is not optional. A build that quietly produced unsigned artifacts
# would break auto-update for every client that installed them, and they would
# only find out at the next update.
#
# The Tauri CLI reads this variable as the key itself or, when the value names
# an existing file, as the path to it (see tauri-cli bundle.rs), so handing it
# a path keeps the key off the process list and out of the environment dump.
export TAURI_SIGNING_PRIVATE_KEY="$KEY"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$UPDATER_KEY_PASSWORD"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
STAGE="$(mktemp -d)"
PKG="$(mktemp -d)"
trap 'rm -rf "$STAGE" "$PKG"' EXIT

echo "==> PeerDesk ${VERSION} -> ${CACHE_DIR}"

echo "[1/7] frontend"
cd "$ROOT/desktop"
npm ci
npm run build

echo "[2/7] agent, Linux and Windows"
cd "$ROOT"
cargo build -p peerdesk-agent --release
cargo build -p peerdesk-agent --release --target x86_64-pc-windows-gnu
cp target/release/peerdesk-agent          "$STAGE/peerdesk-agent-linux-x86_64-${VERSION}"
cp target/release/peerdesk-agent          "$STAGE/peerdesk-agent-linux-x86_64-headless-${VERSION}"
cp target/x86_64-pc-windows-gnu/release/peerdesk-agent.exe \
                                          "$STAGE/peerdesk-agent-windows-x86_64-${VERSION}.exe"

echo "[3/7] viewer, Linux bundles"
# The supported path: host and target agree, so the Tauri CLI bundles normally.
cd "$ROOT/desktop"
cargo tauri build
BUNDLE=src-tauri/target/release/bundle
cp "$BUNDLE"/deb/*.deb               "$STAGE/peerdesk-viewer-linux-${VERSION}-amd64.deb"
cp "$BUNDLE"/rpm/*.rpm               "$STAGE/peerdesk-viewer-linux-${VERSION}-x86_64.rpm"
cp "$BUNDLE"/appimage/*.AppImage     "$STAGE/peerdesk-viewer-linux-${VERSION}.AppImage"
cp "$BUNDLE"/appimage/*.AppImage.sig "$STAGE/peerdesk-viewer-linux-${VERSION}.AppImage.sig"

echo "[4/7] viewer, Windows binary"
# Compiles fine cross-platform; only the bundling has to be done by hand.
cargo build --release --target x86_64-pc-windows-gnu --manifest-path src-tauri/Cargo.toml

echo "[5/7] Windows installers"
cp src-tauri/target/x86_64-pc-windows-gnu/release/peerdesk-desktop.exe "$PKG/"
cp "$ROOT"/deploy/builder/installers/peerdesk-viewer.wxs "$PKG/"
cp "$ROOT"/deploy/builder/installers/peerdesk-viewer.nsi "$PKG/"

# wixl wants a bare numeric version; the tag carries a leading v.
NUMERIC="${VERSION#v}"
# An MSI ProductVersion is three numeric fields and nothing else, so a tag with
# a pre-release suffix (v1.2.3-rc1, and the v0.0.0-local used for test runs)
# has to be trimmed for the MSI. NSIS only prints the version, so it keeps the
# full tag and stays honest about which build it is.
MSI_VERSION="$(printf '%s' "$NUMERIC" | sed 's/[-+].*$//')"
case "$MSI_VERSION" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "VERSION ${VERSION} does not yield an x.y.z MSI version" >&2; exit 1 ;;
esac
(
  cd "$PKG"
  wixl -D Version="$MSI_VERSION" \
       -o "$STAGE/peerdesk-viewer-windows-${VERSION}-x64.msi" peerdesk-viewer.wxs
  makensis -DVERSION="$NUMERIC" \
           -DOUTFILE="$STAGE/peerdesk-viewer-windows-${VERSION}-x64-setup.exe" \
           peerdesk-viewer.nsi
)

# The setup .exe is an updater artifact, so it needs a detached signature the
# same way the AppImage does. The MSI is not offered as an update, so it has none.
#
# TAURI_SIGNING_PRIVATE_KEY has to come off the environment for this one call.
# `signer sign` binds that variable to `--private-key`, which is declared
# `conflicts_with("private_key_path")`, so leaving it set makes the explicit
# path flag a hard error - and it cannot simply be dropped either, because
# `signer sign` reads `--private-key` as the key itself with none of the
# "is this a file?" handling that the bundler applies to the same variable.
env -u TAURI_SIGNING_PRIVATE_KEY cargo tauri signer sign \
  --private-key-path "$KEY" \
  --password "$UPDATER_KEY_PASSWORD" \
  "$STAGE/peerdesk-viewer-windows-${VERSION}-x64-setup.exe"

echo "[6/7] verify the staged artifacts"
# Every step above can exit zero and leave nothing behind - a glob that matched
# a stale file, a bundler that skipped a target. Name what has to exist and
# fail here rather than publishing a half release into the cache.
expected=(
  "peerdesk-agent-linux-x86_64-${VERSION}"
  "peerdesk-agent-linux-x86_64-headless-${VERSION}"
  "peerdesk-agent-windows-x86_64-${VERSION}.exe"
  "peerdesk-viewer-linux-${VERSION}-amd64.deb"
  "peerdesk-viewer-linux-${VERSION}-x86_64.rpm"
  "peerdesk-viewer-linux-${VERSION}.AppImage"
  "peerdesk-viewer-linux-${VERSION}.AppImage.sig"
  "peerdesk-viewer-windows-${VERSION}-x64.msi"
  "peerdesk-viewer-windows-${VERSION}-x64-setup.exe"
  "peerdesk-viewer-windows-${VERSION}-x64-setup.exe.sig"
)
for name in "${expected[@]}"; do
  [ -s "$STAGE/$name" ] || { echo "missing or empty artifact: $name" >&2; exit 1; }
done

echo "[7/7] publish"
mkdir -p "$CACHE_DIR"
# Replace the cache contents wholesale: a directory holding two versions would
# leave the manifest describing files that are no longer the current release.
find "$CACHE_DIR" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
cp "$STAGE"/* "$CACHE_DIR/"
python3 "$ROOT/deploy/builder/write_manifest.py" "$CACHE_DIR" "$VERSION" "Built locally."

echo "==> done"
ls -la "$CACHE_DIR"
