#!/usr/bin/env bash
# Builds the Chrome Web Store submission zip (npm run pack:webstore).
# Same code as the unpacked build, with a store-safe manifest transform:
#   - strips `key` (CWS rejects packages that include it; the published ID
#     will differ from the dev ID — verified safe: extension auth is brokered
#     server-side and accepts any *.chromiumapp.org redirect)
#   - drops dev + legacy surfaces (localhost, Twitter/X, ManyChat, AgoraPulse)
#     so every remaining permission has a clean justification
#   - narrows web_accessible_resources to Instagram only
# The unpacked build (pack-extension.sh) is untouched — it keeps everything.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/chrome-extension/ig-lead-tracker"
OUT="$ROOT/dist"

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT
mkdir -p "$OUT"

cp -R "$SRC" "$STAGE/fanbasis-extension"
find "$STAGE" -name ".DS_Store" -delete

python3 - "$STAGE/fanbasis-extension/manifest.json" <<'PY'
import json, sys

path = sys.argv[1]
m = json.load(open(path))

m.pop("key", None)
m["description"] = "FanBasis sales cockpit: capture Instagram leads, work the outreach queue, and book AE calls without leaving IG."

KEEP_HOSTS = (
    "https://www.instagram.com/*",
    "https://i.instagram.com/*",
    "https://www.linkedin.com/*",
    "https://unified-sales-ops.vercel.app/*",
)
m["host_permissions"] = [h for h in m["host_permissions"] if h in KEEP_HOSTS]

def keeps(matches):
    return any("instagram" in x or "linkedin" in x for x in matches)
m["content_scripts"] = [cs for cs in m["content_scripts"] if keeps(cs["matches"])]

# Drop the legacy scripts entirely so reviewers don't flag orphan files
import os
d = os.path.dirname(path)
for f in ("twitter.js", "content.js", "agora.js"):
    p = os.path.join(d, f)
    if os.path.exists(p):
        os.remove(p)

m["web_accessible_resources"] = [{
    "resources": ["page-interceptor.js"],
    "matches": ["https://www.instagram.com/*"],
}]

json.dump(m, open(path, "w"), indent=2)
print(f"webstore manifest: v{m['version']}, {len(m['host_permissions'])} hosts, {len(m['content_scripts'])} content scripts")
PY

rm -f "$OUT/fanbasis-extension-webstore.zip"
(cd "$STAGE/fanbasis-extension" && zip -qr "$OUT/fanbasis-extension-webstore.zip" .)

echo "packed → dist/fanbasis-extension-webstore.zip ($(du -h "$OUT/fanbasis-extension-webstore.zip" | cut -f1 | tr -d ' '))"
