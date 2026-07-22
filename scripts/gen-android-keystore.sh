#!/usr/bin/env bash
# Generates an Android keystore for PeerDesk and produces the secrets.env file
# with the exact values to add as GitHub Repository Secrets.
#
# Requirements: keytool (comes with JDK — apt install default-jdk or brew install openjdk)
#
# Run once:
#   bash scripts/gen-android-keystore.sh
#
# Output:
#   peerdesk-release.jks   — keep it somewhere safe (NOT in git!)
#   android-secrets.env    — content for GitHub Secrets

set -euo pipefail

KEYSTORE_FILE="peerdesk-release.jks"
SECRETS_FILE="android-secrets.env"
KEY_ALIAS="peerdesk"

# ── Check keytool ──────────────────────────────────────────────────────────
if ! command -v keytool &>/dev/null; then
  echo "Error: keytool is not installed."
  echo "  Ubuntu/Debian: sudo apt install default-jdk"
  echo "  macOS:         brew install openjdk"
  exit 1
fi

# ── Password ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Generating PeerDesk Android keystore ==="
echo ""
echo "Enter a password for the keystore (min 6 characters):"
read -r -s KEYSTORE_PASS
echo ""
echo "Confirm the password:"
read -r -s KEYSTORE_PASS2
echo ""
if [[ "$KEYSTORE_PASS" != "$KEYSTORE_PASS2" ]]; then
  echo "Passwords do not match. Try again."
  exit 1
fi
if [[ ${#KEYSTORE_PASS} -lt 6 ]]; then
  echo "The password must be at least 6 characters."
  exit 1
fi

# ── Generate keystore ─────────────────────────────────────────────────────────
echo "Generating keystore..."
keytool -genkey -v \
  -keystore "$KEYSTORE_FILE" \
  -alias "$KEY_ALIAS" \
  -keyalg RSA \
  -keysize 2048 \
  -validity 10000 \
  -storepass "$KEYSTORE_PASS" \
  -keypass "$KEYSTORE_PASS" \
  -dname "CN=PeerDesk, O=Ancyent, C=RO" \
  2>/dev/null

echo "Keystore generated: $KEYSTORE_FILE"

# ── Base64 encoding (no newlines) ──────────────────────────────────────────
KEYSTORE_B64=$(base64 -w0 "$KEYSTORE_FILE" 2>/dev/null || base64 "$KEYSTORE_FILE" | tr -d '\n')

# ── Write the secrets file ───────────────────────────────────────────────
cat > "$SECRETS_FILE" << EOF
# GitHub Repository Secrets for PeerDesk Android signing
# Add each value at:
# https://github.com/Ancyent/peerdesk/settings/secrets/actions
#
# For each secret: New repository secret → Name + Value below
# Delete this file after you've added the secrets!

ANDROID_KEYSTORE =
$KEYSTORE_B64

ANDROID_KEY_ALIAS =
$KEY_ALIAS

ANDROID_KEYSTORE_PASSWORD =
$KEYSTORE_PASS

ANDROID_KEY_PASSWORD =
$KEYSTORE_PASS
EOF

# ── Add to .gitignore ──────────────────────────────────────────────────────
REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || echo ".")"
GITIGNORE="$REPO_ROOT/.gitignore"
for entry in "peerdesk-release.jks" "android-secrets.env"; do
  if ! grep -qxF "$entry" "$GITIGNORE" 2>/dev/null; then
    echo "$entry" >> "$GITIGNORE"
  fi
done

# ── Final report ──────────────────────────────────────────────────────────────
echo ""
echo "=== Done! ==="
echo ""
echo "Files generated:"
echo "  $KEYSTORE_FILE  — back it up somewhere safe, do NOT commit it to git"
echo "  $SECRETS_FILE   — open it and copy the values into GitHub"
echo ""
echo "Next steps:"
echo "  1. Open $SECRETS_FILE"
echo "  2. Add/replace the 4 secrets on GitHub:"
echo "     https://github.com/Ancyent/peerdesk/settings/secrets/actions"
echo "  3. Delete $SECRETS_FILE when you're done"
echo ""
echo "IMPORTANT: Do not commit peerdesk-release.jks and android-secrets.env to git!"
