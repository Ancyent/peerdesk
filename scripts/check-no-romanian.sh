#!/usr/bin/env bash
# Fails if Romanian diacritics appear in tracked source outside still-Romanian
# areas. Web (web/) and desktop (desktop/) are excluded until i18n phases P1/P3
# translate their strings; remove those exclusions when each phase lands.
# docs/superpowers is gitignored (local-only) and never scanned.
set -euo pipefail

# Paths still allowed to contain Romanian (cleaned by later phases).
EXCLUDES=(':!web' ':!desktop')

hits="$(git grep -nI '[ăâîșțĂÂÎȘȚ]' -- . "${EXCLUDES[@]}" || true)"

if [ -n "$hits" ]; then
  echo "ERROR: Romanian diacritics found in cleaned areas:" >&2
  echo "$hits" >&2
  echo "" >&2
  echo "English is the primary language. Translate the text above." >&2
  exit 1
fi
echo "OK: no Romanian diacritics in cleaned areas."
