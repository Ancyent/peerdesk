#!/usr/bin/env bash
# Generează keystore Android pentru PeerDesk și produce fișierul secrets.env
# cu valorile exacte care trebuie adăugate ca GitHub Repository Secrets.
#
# Cerințe: keytool (vine cu JDK — apt install default-jdk sau brew install openjdk)
#
# Rulează o singură dată:
#   bash scripts/gen-android-keystore.sh
#
# Output:
#   peerdesk-release.jks   — păstrează-l în loc sigur (NU în git!)
#   android-secrets.env    — conținut pentru GitHub Secrets

set -euo pipefail

KEYSTORE_FILE="peerdesk-release.jks"
SECRETS_FILE="android-secrets.env"
KEY_ALIAS="peerdesk"

# ── Verifică keytool ──────────────────────────────────────────────────────────
if ! command -v keytool &>/dev/null; then
  echo "Eroare: keytool nu este instalat."
  echo "  Ubuntu/Debian: sudo apt install default-jdk"
  echo "  macOS:         brew install openjdk"
  exit 1
fi

# ── Parolă ───────────────────────────────────────────────────────────────────
echo ""
echo "=== Generare keystore Android PeerDesk ==="
echo ""
echo "Introdu o parolă pentru keystore (min 6 caractere):"
read -r -s KEYSTORE_PASS
echo ""
echo "Confirmă parola:"
read -r -s KEYSTORE_PASS2
echo ""
if [[ "$KEYSTORE_PASS" != "$KEYSTORE_PASS2" ]]; then
  echo "Parolele nu coincid. Încearcă din nou."
  exit 1
fi
if [[ ${#KEYSTORE_PASS} -lt 6 ]]; then
  echo "Parola trebuie să aibă cel puțin 6 caractere."
  exit 1
fi

# ── Generare keystore ─────────────────────────────────────────────────────────
echo "Generez keystore..."
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

echo "Keystore generat: $KEYSTORE_FILE"

# ── Encodare base64 (fără newlines) ──────────────────────────────────────────
KEYSTORE_B64=$(base64 -w0 "$KEYSTORE_FILE" 2>/dev/null || base64 "$KEYSTORE_FILE" | tr -d '\n')

# ── Scrie fișierul cu secretele ───────────────────────────────────────────────
cat > "$SECRETS_FILE" << EOF
# GitHub Repository Secrets pentru PeerDesk Android signing
# Adaugă fiecare valoare la:
# https://github.com/Ancyent/peerdesk/settings/secrets/actions
#
# Pentru fiecare secret: New repository secret → Name + Value de mai jos
# Șterge acest fișier după ce ai adăugat secretele!

ANDROID_KEYSTORE =
$KEYSTORE_B64

ANDROID_KEY_ALIAS =
$KEY_ALIAS

ANDROID_KEYSTORE_PASSWORD =
$KEYSTORE_PASS

ANDROID_KEY_PASSWORD =
$KEYSTORE_PASS
EOF

# ── Adaugă la .gitignore ──────────────────────────────────────────────────────
REPO_ROOT="$(git -C "$(dirname "$0")" rev-parse --show-toplevel 2>/dev/null || echo ".")"
GITIGNORE="$REPO_ROOT/.gitignore"
for entry in "peerdesk-release.jks" "android-secrets.env"; do
  if ! grep -qxF "$entry" "$GITIGNORE" 2>/dev/null; then
    echo "$entry" >> "$GITIGNORE"
  fi
done

# ── Raport final ──────────────────────────────────────────────────────────────
echo ""
echo "=== Gata! ==="
echo ""
echo "Fișiere generate:"
echo "  $KEYSTORE_FILE  — fă backup în loc sigur, NU îl comite în git"
echo "  $SECRETS_FILE   — deschide-l și copiază valorile pe GitHub"
echo ""
echo "Pași următori:"
echo "  1. Deschide $SECRETS_FILE"
echo "  2. Adaugă/înlocuiește cele 4 secrete pe GitHub:"
echo "     https://github.com/Ancyent/peerdesk/settings/secrets/actions"
echo "  3. Șterge $SECRETS_FILE după ce ai terminat"
echo ""
echo "IMPORTANT: Nu comite peerdesk-release.jks și android-secrets.env în git!"
