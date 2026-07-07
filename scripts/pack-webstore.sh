#!/usr/bin/env bash
# Builds the Chrome Web Store submission zip (npm run pack:webstore).
# The source manifest is already Instagram-only (legacy LinkedIn/Twitter/ManyChat/
# AgoraPulse surfaces were deleted in v2.9.0), so the store transform is now minimal:
#   - strips `key` (CWS rejects packages that include it; the published ID
#     will differ from the dev ID — verified safe: extension auth is brokered
#     server-side and accepts any *.chromiumapp.org redirect)
#   - drops the localhost dev host so every remaining permission has a clean
#     justification for reviewers
#   - sets a marketing description
# The unpacked build (pack-extension.sh) is untouched — it keeps localhost for dev.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/chrome-extension/ig-lead-tracker"
OUT="$ROOT/dist"

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$OUT"

# Contract QUEUE: regenerate outreach-queue.js from lib/queue.ts before staging
# (mirrors pack-extension.sh) so the store build can never ship a drifted copy.
OQ="$SRC/outreach-queue.js"
if ! npx esbuild "$ROOT/lib/queue.ts" --bundle --format=iife \
      --global-name=FBQueue --tsconfig="$ROOT/tsconfig.json" \
      --banner:js="// GENERATED from lib/queue.ts by pack-extension.sh — DO NOT EDIT. Edit lib/queue.ts and re-run npm run pack:ext." \
      --footer:js="if(typeof window!=='undefined')window.FBQueue=FBQueue;" \
      --outfile="$OQ"; then
  echo "✗ esbuild failed bundling lib/queue.ts — likely a non-browser-pure import (a T1 fix). Aborting." >&2
  exit 1
fi

cp -R "$SRC" "$STAGE/fanbasis-extension"
find "$STAGE" -name ".DS_Store" -delete

# The PUBLISHED item's public key (extension id cmpjjdmdaegnnmfmcjjekfninghkoikd),
# extracted from the store-served CRX header 2026-07-07. CWS requires every
# update package's key to MATCH the item — the repo's dev key (a different
# keypair, id ckiknpaiindhapocfloenompedkgneoa) gets rejected with "key field
# value in the manifest doesn't match the current item", and so did keyless
# uploads for this item. This key is public (it ships in every user's
# installed manifest) — safe to keep here.
STORE_KEY="MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAv0spAuRCVN2an1KqxDHiKaVXZnA+qc6ZdPOECyu8Z3J9m7uRP3m9MyOEHx9Us6JFuuTSrxJ17FvSAphhyHhzRdPx+KD0MEBynYAlSiIhgZTFSnIGayoEGFs3EJyKi3C6aLVdSrGhT88R81fM3rUTwd7Fxqzw0JI+ahuvOobMVWiA1IEc/WQB5p86veWVJCZAIyl+2vJSqNAW++IASbIXph8TR3bb3MqXrg2taxj/K7HCbgtbG4d1YZky8uD7O2g6ZUvTq4n84tnFh8YcQos7qTLiAZNtUrN8WkjnGMBqnCDPCS2YQb7otdPqR6kpjEf4KQq+oTdi830lrciOpnFHFQIDAQAB"

STORE_KEY="$STORE_KEY" python3 - "$STAGE/fanbasis-extension/manifest.json" <<'PY'
import json, sys, os

path = sys.argv[1]
m = json.load(open(path))

# Replace the dev key with the published item's key (see STORE_KEY note above).
m["key"] = os.environ["STORE_KEY"]
m["description"] = "FanBasis sales cockpit: capture Instagram leads, work the outreach queue, and book AE calls without leaving IG."

# Drop only the localhost dev host — the source manifest is already store-shaped.
m["host_permissions"] = [h for h in m["host_permissions"] if "localhost" not in h]

json.dump(m, open(path, "w"), indent=2)
print(f"webstore manifest: v{m['version']}, {len(m['host_permissions'])} hosts, {len(m['content_scripts'])} content scripts")
PY

rm -f "$OUT/fanbasis-extension-webstore.zip"
(cd "$STAGE/fanbasis-extension" && zip -qr "$OUT/fanbasis-extension-webstore.zip" .)

echo "packed → dist/fanbasis-extension-webstore.zip ($(du -h "$OUT/fanbasis-extension-webstore.zip" | cut -f1 | tr -d ' '))"
