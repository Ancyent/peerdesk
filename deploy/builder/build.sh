#!/usr/bin/env bash
# Build every Linux and Windows client and place them in the release cache.
#
# The cache is what server/api/release_cache.py serves, so once this finishes
# the Downloads page, install.sh and the updater all offer these artifacts with
# no code change anywhere.
#
# This writes into the checkout it is pointed at: `npm ci` replaces
# desktop/node_modules, both target/ trees are filled with release objects, and
# the Windows cross-build generates
# desktop/src-tauri/gen/schemas/windows-schema.json. No tracked file is
# modified: the release version is stamped through TAURI_CONFIG and
# `cargo tauri build --config`, so a build killed with `docker rm -f` leaves
# the checkout exactly as it found it.
set -euo pipefail

VERSION="${VERSION:?VERSION must be set, e.g. VERSION=v1.2.3}"
CACHE_DIR="${CACHE_DIR:-/var/lib/peerdesk/releases}"
KEY="${UPDATER_KEY_PATH:?UPDATER_KEY_PATH must be set}"
: "${UPDATER_KEY_PASSWORD:?UPDATER_KEY_PASSWORD must be set}"

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
CONF="$ROOT/desktop/src-tauri/tauri.conf.json"

# ── Preflight ────────────────────────────────────────────────────────────────
# Everything that can be known before the first compile is checked here, so a
# bad argument costs a second rather than the half hour it takes to reach the
# step that would have tripped over it.

# One version string feeds four packages, and the strictest of them sets the
# rule: an RPM Version field cannot contain a hyphen, and an MSI ProductVersion
# is three numeric fields and nothing else. A pre-release tag is therefore not
# something to trim quietly - trimming would ship an installer whose version
# disagrees with the tag it was built from. Refuse it and say why.
# The leading `v` is not cosmetic. web/public/install.sh resolves the agent by
# grepping the manifest for `peerdesk-agent-linux-x86_64-v[^"]*` (and the
# `-headless-v` variant), so an artifact named ...-1.2.3 is invisible to it: the
# build goes green, the cache fills, the Downloads page works, and every
# `install.sh` run fails with "no Linux agent binary". Cheaper to refuse here.
case "$VERSION" in
  v*) ;;
  *) echo "VERSION '${VERSION}' must start with 'v', e.g. v1.2.3." >&2
     echo "install.sh looks the agent up by the literal name shape" >&2
     echo "'peerdesk-agent-linux-x86_64-v...', so artifacts built without the" >&2
     echo "'v' are published but can never be installed." >&2
     exit 1 ;;
esac

NUMERIC="${VERSION#v}"
case "$NUMERIC" in
  *-*|*+*)
    echo "VERSION '${VERSION}' is a pre-release tag." >&2
    echo "An RPM Version cannot contain '-' and an MSI ProductVersion is three" >&2
    echo "numeric fields, so two of the four packages this builds cannot express" >&2
    echo "it. Tag the release x.y.z (e.g. v1.2.3) and re-run." >&2
    exit 1 ;;
esac
case "$NUMERIC" in
  [0-9]*.[0-9]*.[0-9]*) ;;
  *) echo "VERSION '${VERSION}' does not yield an x.y.z version" >&2; exit 1 ;;
esac

# CACHE_DIR is emptied before it is repopulated, so a wrong value here is
# destructive. The checkout is mounted in this same container, which puts the
# dangerous value one typo away from the documented invocation.
case "$CACHE_DIR" in
  /*) ;;
  *) echo "CACHE_DIR must be an absolute path, got '${CACHE_DIR}'" >&2; exit 1 ;;
esac
# Compare resolved paths, not the strings as typed. A lexical comparison lets
# `/work/../work` and any symlinked spelling of the same directory slip past a
# guard that is the only thing standing between a typo and `rm -rf` over the
# source tree. `-m` because the cache directory legitimately may not exist yet;
# ROOT always does.
CACHE_DIR="$(realpath -m "$CACHE_DIR")"
ROOT="$(realpath "$ROOT")"
if [ "$CACHE_DIR" = "/" ]; then
  echo "CACHE_DIR must not be the filesystem root" >&2
  exit 1
fi
# Both directions, because both are destructive. The publish step empties
# CACHE_DIR, so a cache that CONTAINS the checkout deletes the sources being
# read - and a cache nested INSIDE the checkout (e.g. CACHE_DIR=/work/deploy)
# deletes them just as thoroughly one level down. Equality is caught by the
# first pattern, since `*` also matches the empty string.
case "$ROOT/" in
  "$CACHE_DIR"/*)
    echo "CACHE_DIR '${CACHE_DIR}' contains the checkout at '${ROOT}'." >&2
    echo "Publishing there would delete the source tree this build reads." >&2
    exit 1 ;;
esac
case "$CACHE_DIR/" in
  "$ROOT"/*)
    echo "CACHE_DIR '${CACHE_DIR}' is inside the checkout at '${ROOT}'." >&2
    echo "Publishing there would delete part of the source tree this build reads." >&2
    exit 1 ;;
esac

[ -r "$KEY" ] || { echo "UPDATER_KEY_PATH '${KEY}' is not readable" >&2; exit 1; }

# Signing is not optional. A build that quietly produced unsigned artifacts
# would break auto-update for every client that installed them, and they would
# only find out at the next update.
#
# The Tauri CLI reads this variable as the key itself or, when the value names
# an existing file, as the path to it (see tauri-cli bundle.rs), so handing it
# a path keeps the key off the process list and out of the environment dump.
export TAURI_SIGNING_PRIVATE_KEY="$KEY"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$UPDATER_KEY_PASSWORD"

STAGE=""
PKG=""
# Set once the publish step starts staging into the cache. It has to be cleaned
# up on failure as well: the copy it holds is most likely to fail by filling the
# cache filesystem, and leaving the half-copy behind would keep that filesystem
# full after the build has gone.
INCOMING=""
cleanup() {
  [ -n "$STAGE" ] && rm -rf "$STAGE"
  [ -n "$PKG" ] && rm -rf "$PKG"
  [ -n "$INCOMING" ] && rm -rf "$INCOMING"
  return 0
}
trap cleanup EXIT
trap 'cleanup; exit 130' INT
trap 'cleanup; exit 143' TERM

STAGE="$(mktemp -d)"
PKG="$(mktemp -d)"

# The public key the shipped clients actually check updates against. Signatures
# are verified against this rather than against the private key we just signed
# with, because the failure being guarded is precisely the two disagreeing.
PUBKEY_FILE="$PKG/updater.pub"
python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["plugins"]["updater"]["pubkey"])' \
  "$CONF" | base64 -d > "$PUBKEY_FILE"

# Sign a scratch file and verify it. Proves the key is readable, the password is
# right, and - the part no existence check can reach - that this key matches the
# pubkey compiled into the clients. Getting that wrong yields a green build
# whose updates every installed client silently rejects.
sign_updater_artifact() {
  env -u TAURI_SIGNING_PRIVATE_KEY cargo tauri signer sign \
    --private-key-path "$KEY" \
    --password "$UPDATER_KEY_PASSWORD" \
    "$1" >/dev/null
}

verify_updater_signature() {
  local artifact="$1"
  local decoded="$PKG/$(basename "$artifact").minisig"
  [ -s "$artifact.sig" ] || { echo "no signature for $(basename "$artifact")" >&2; return 1; }
  base64 -d "$artifact.sig" > "$decoded" 2>/dev/null \
    || { echo "signature for $(basename "$artifact") is not base64" >&2; return 1; }
  # stdout only: minisign's stderr carries the real cause when the failure is
  # not a mismatch at all (missing binary, unreadable pubkey, malformed input).
  # Swallowing it turned every such breakage into a misleading "does not verify".
  minisign -V -p "$PUBKEY_FILE" -x "$decoded" -m "$artifact" >/dev/null \
    || { echo "signature for $(basename "$artifact") does not verify against the pubkey in tauri.conf.json" >&2; return 1; }
}

echo "==> PeerDesk ${VERSION} -> ${CACHE_DIR}"

echo "[0/7] signing key self-test"
printf 'peerdesk signing self-test\n' > "$PKG/keycheck"
sign_updater_artifact "$PKG/keycheck"
verify_updater_signature "$PKG/keycheck" || {
  echo "the updater key does not match the pubkey in tauri.conf.json - refusing to build" >&2
  exit 1
}

# Stamp the release version into the app itself. Without this the bundles carry
# whatever version the checkout happens to hold, and a client that installs the
# update still reports the old version afterwards, so the server offers it the
# same update forever.
#
# Tauri reads this in two places and needs both. tauri-build merges TAURI_CONFIG
# into the config it compiles in, which is what reaches the Windows viewer --
# that one is built by a plain `cargo build`, where the CLI never runs. The CLI
# merges --config into its own view, which is what stamps the deb/rpm/AppImage
# metadata; it sets TAURI_CONFIG for its children but never reads it, so the
# variable alone would leave those packages on the wrong version.
#
# Doing it this way means the build writes no tracked file at all, so a
# container killed with `docker rm -f` leaves nothing behind. Stage A stamped
# tauri.conf.json in place and restored it on exit, which a SIGKILL defeated.
TAURI_CONFIG="$(python3 -c '
import json, sys
sys.path.insert(0, sys.argv[1])
import brand
print(json.dumps(brand.tauri_config(None, sys.argv[2])))
' "$ROOT/deploy/builder" "$NUMERIC")"
export TAURI_CONFIG
echo "    app version stamped to ${NUMERIC}"

echo "[1/7] frontend"
cd "$ROOT/desktop"
npm ci
npm run build

echo "[2/7] agent, Linux and Windows"
cd "$ROOT"
# Full GUI host first, and copied out before the headless build overwrites it -
# both land on the same target/release/peerdesk-agent path.
cargo build -p peerdesk-agent --release
cp target/release/peerdesk-agent          "$STAGE/peerdesk-agent-linux-x86_64-${VERSION}"
# --no-default-features drops xcap/openh264/enigo/arboard/cpal, so this binary
# links no pipewire/X11/ALSA and starts on the minimal and headless servers its
# name points at. Copying the GUI binary twice, as an earlier revision did,
# produced a "headless" artifact that could not start on any of them.
cargo build -p peerdesk-agent --release --no-default-features
cp target/release/peerdesk-agent          "$STAGE/peerdesk-agent-linux-x86_64-headless-${VERSION}"
cargo build -p peerdesk-agent --release --target x86_64-pc-windows-gnu
cp target/x86_64-pc-windows-gnu/release/peerdesk-agent.exe \
                                          "$STAGE/peerdesk-agent-windows-x86_64-${VERSION}.exe"

echo "[3/7] viewer, Linux bundles"
# The supported path: host and target agree, so the Tauri CLI bundles normally.
cd "$ROOT/desktop"
BUNDLE=src-tauri/target/release/bundle
# A bundler that exits zero without emitting anything would otherwise leave the
# previous run's bundle here to be published under the new tag.
rm -rf "$BUNDLE"
cargo tauri build --config "$TAURI_CONFIG"
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
(
  cd "$PKG"
  wixl -D Version="$NUMERIC" \
       -D ProductName="PeerDesk" \
       -D BinaryName="peerdesk-desktop.exe" \
       -o "$STAGE/peerdesk-viewer-windows-${VERSION}-x64.msi" peerdesk-viewer.wxs
  makensis -DVERSION="$NUMERIC" \
           -DPRODUCT_NAME="PeerDesk" \
           -DBINARY_NAME="peerdesk-desktop.exe" \
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
sign_updater_artifact "$STAGE/peerdesk-viewer-windows-${VERSION}-x64-setup.exe"

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

# A .sig existing proves only that a file was written. These are what every
# installed client checks before applying an update, so check them the same way
# the client will.
verify_updater_signature "$STAGE/peerdesk-viewer-linux-${VERSION}.AppImage"
verify_updater_signature "$STAGE/peerdesk-viewer-windows-${VERSION}-x64-setup.exe"
echo "    both updater signatures verify against the shipped pubkey"

echo "[7/7] publish"
mkdir -p "$CACHE_DIR"
# Copy in beside the live release first, and only replace it once the whole set
# has landed. Deleting first would mean a copy that runs out of disk halfway -
# which this build has done - leaves the cache holding a partial release and no
# manifest, recoverable only by re-running the entire build.
INCOMING="$CACHE_DIR/.incoming"
rm -rf "$INCOMING"
mkdir -p "$INCOMING"
# From here the trap owns it, so a failed copy does not leave the cache
# filesystem full.
cp "$STAGE"/* "$INCOMING/"
python3 "$ROOT/deploy/builder/write_manifest.py" "$INCOMING" "$VERSION" "Built locally."

# The swap itself moves within one filesystem, so it consumes no space and
# cannot fail the way the copy can. A directory holding two versions would leave
# the manifest describing files that are no longer the current release, so the
# old set goes in one step immediately before the new one lands.
find "$CACHE_DIR" -mindepth 1 -maxdepth 1 ! -name .incoming -exec rm -rf {} +
mv "$INCOMING"/* "$CACHE_DIR/"
rmdir "$INCOMING"

echo "==> done"
ls -la "$CACHE_DIR"
