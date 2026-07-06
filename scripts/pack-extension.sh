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

# ── Contract QUEUE: regenerate outreach-queue.js from the canonical lib/queue.ts ──
# The extension's queue module is a bundle of lib/queue.ts (+ lib/stages.ts) so the
# dashboard and the extension can never drift. We regenerate IN PLACE before staging,
# so a hand-edit or an un-repacked lib/queue.ts change can't ship: the committed copy
# is overwritten by fresh output every pack. If it changed, we shout so it gets
# committed (Load-unpacked users read the committed file, not the zip).
OQ="$SRC/outreach-queue.js"
BEFORE_OQ="$(cat "$OQ" 2>/dev/null || true)"
if ! npx esbuild "$ROOT/lib/queue.ts" --bundle --format=iife \
      --global-name=FBQueue --tsconfig="$ROOT/tsconfig.json" \
      --banner:js="// GENERATED from lib/queue.ts by pack-extension.sh — DO NOT EDIT. Edit lib/queue.ts and re-run npm run pack:ext." \
      --footer:js="if(typeof window!=='undefined')window.FBQueue=FBQueue;" \
      --outfile="$OQ"; then
  echo "✗ esbuild failed bundling lib/queue.ts — likely a non-browser-pure import (a T1 fix, not an extension workaround). Aborting." >&2
  exit 1
fi
if [ "$BEFORE_OQ" != "$(cat "$OQ")" ]; then
  echo "⚠ outreach-queue.js was stale — regenerated from lib/queue.ts. COMMIT the updated file so 'Load unpacked' users get it."
fi

# Stage under a friendly folder name — this is the folder teammates keep and
# point "Load unpacked" at.
cp -R "$SRC" "$STAGE/fanbasis-extension"
find "$STAGE" -name ".DS_Store" -delete

rm -f "$OUT/fanbasis-extension.zip"
(cd "$STAGE" && zip -qr "$OUT/fanbasis-extension.zip" fanbasis-extension)

printf '{ "version": "%s", "updatedAt": "%s" }\n' \
  "$VERSION" "$(date -u +%Y-%m-%dT%H:%M:%SZ)" > "$OUT/latest.json"

echo "packed v$VERSION → public/extension/fanbasis-extension.zip ($(du -h "$OUT/fanbasis-extension.zip" | cut -f1 | tr -d ' '))"
