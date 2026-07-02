#!/usr/bin/env bash
# Packages the Chrome extension into public/extension/ so the dashboard can
# distribute it (/settings/extension). Run after any extension change, before
# committing:  npm run pack:ext
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/chrome-extension/ig-lead-tracker"
OUT="$ROOT/public/extension"
VERSION=$(python3 -c "import json; print(json.load(open('$SRC/manifest.json'))['version'])")

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$OUT"

# Stage under a friendly folder name — this is the folder teammates keep and
# point "Load unpacked" at.
cp -R "$SRC" "$STAGE/fanbasis-extension"
find "$STAGE" -name ".DS_Store" -delete

rm -f "$OUT/fanbasis-extension.zip"
(cd "$STAGE" && zip -qr "$OUT/fanbasis-extension.zip" fanbasis-extension)

printf '{ "version": "%s", "updatedAt": "%s" }\n' \
  "$VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$OUT/latest.json"

echo "packed v$VERSION → public/extension/fanbasis-extension.zip ($(du -h "$OUT/fanbasis-extension.zip" | cut -f1 | tr -d ' '))"
