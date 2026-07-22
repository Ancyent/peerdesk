#!/usr/bin/env bash
# Fails if Romanian diacritics appear in tracked source outside still-Romanian
# areas. Web (web/) and desktop (desktop/) are excluded until i18n phases P1/P3
# translate their strings; remove those exclusions when each phase lands.
# docs/superpowers is gitignored (local-only) and never scanned.
#
# The diacritic set is expressed as PCRE unicode escapes (not literal glyphs) so
# this script does not match itself and has no blind spot. It covers modern
# comma-below forms (U+0218..U+021B) and legacy cedilla forms (U+0162, U+0163,
# U+015E, U+015F).
set -euo pipefail

EXCLUDES=(':!web' ':!desktop')
PATTERN='[\x{0103}\x{00e2}\x{00ee}\x{0219}\x{021b}\x{0102}\x{00c2}\x{00ce}\x{0218}\x{021a}\x{015f}\x{015e}\x{0163}\x{0162}]'

set +e
hits="$(git grep -nIP "$PATTERN" -- . "${EXCLUDES[@]}")"
rc=$?
set -e

# git grep exit codes: 0 = matches found, 1 = no matches, >1 = real error.
if [ "$rc" -gt 1 ]; then
  echo "ERROR: git grep failed (exit $rc)" >&2
  exit "$rc"
fi

if [ -n "$hits" ]; then
  echo "ERROR: Romanian diacritics found in cleaned areas:" >&2
  echo "$hits" >&2
  echo "" >&2
  echo "English is the primary language. Translate the text above." >&2
  exit 1
fi
echo "OK: no Romanian diacritics in cleaned areas."
