# HANDOFF — FIX_IGOPEN Terminal 3 (SIDEPANEL) ✅

**Files changed:** `chrome-extension/ig-lead-tracker/sidepanel.js`, `styles.css`, `manifest.json` — nothing else touched.

## What changed

| Build | Change | Where |
|---|---|---|
| 1 | `openInIgTab` rewritten current-window-first: uses the active tab if it's IG, else any IG tab **in this window**, else creates a new tab. Never commandeers an IG tab in another window. | `sidepanel.js:160-176` |
| 2 | `igUrl` is username-first: `igProfileUrl(ig_username) || ig_profile_url || null`. Fixes Open IG (+Copy), Follow-ups Open, and Prev/Next in one place. | `sidepanel.js:151-155` |
| 3 | `updateAccountPill` honest states: reads `activeIgAccountTs`, applies the 5-min freshness contract (`ACCOUNT_MAX_AGE_MS = 5*60*1000`, same as instagram.js). Stale → amber "@handle · checking…" + sends `FB_RECHECK_ACCOUNT` to the current window's IG tab. Fresh mismatch is pink "wrong" **only when both** FanBasis + personal identities are configured; otherwise amber "unknown" with a settings hint in the tooltip. | `sidepanel.js:300-341` |
| 3b | Storage-change listener now also re-runs the pill on `activeIgAccountTs` changes (it filtered to `activeIgAccount` only). | `sidepanel.js:1500` |
| 4 | `.account-pill.unknown` amber styles (border/background/text + dot). | `styles.css:335-336` |
| 5 | `renderOutreach` guard: returns early while `#sp-book-overlay` is open, so background refreshes can't wipe a mid-booking slot selection. | `sidepanel.js:800-804` |
| 6 | Snap-back guard: `panelNavUntil` module var; Prev/Next stamp `Date.now() + 2500` before driving the IG tab; both re-sync paths (`tabs.onUpdated` debounced callback and the `FB_PROFILE_ACTIVE` runtime-message branch) return early inside the window. | `sidepanel.js:243, 386, 1259/1266, 1516` |
| 7 | `manifest.json` version `2.11.0` → `2.12.0`. Nothing else in the manifest. | `manifest.json:4` |

## Deviations from the plan

1. **Build 5 overlay check**: used the plan's suggested cleaner form `bookOverlay.style.display === "flex"` — the overlay initializes with inline `display:none` in `sidepanel.html:98` and is only ever toggled between `"flex"` and `"none"` via inline style, so `=== "flex"` is exact (the plan's `!== "none" && !== ""` variant was offered as the alternative).
2. **Build 6 stamp placement**: `panelNavUntil` is stamped inside the `if (url && outreachChannel === "ig")` branch (immediately before `openInIgTab`), not unconditionally — a Prev/Next that doesn't drive the tab (LinkedIn channel, missing URL) shouldn't suppress legitimate re-syncs.
3. None otherwise — Builds 1–4 and 7 are verbatim from the plan.

## Cross-terminal contract status

- **T2 (`FB_RECHECK_ACCOUNT`)**: ✅ LIVE — T2 shipped first; the handler is at `instagram.js:2950` (dispatches a fresh viewer detection). Type string matches the contract exactly: `FB_RECHECK_ACCOUNT`. My send is still wrapped in `.catch(() => {})` for tabs where the content script isn't loaded.
- **Storage keys**: read-only use of `activeIgAccount` / `activeIgAccountTs`; `background.js:308` already writes both, so freshness has real data today.
- **T1**: no shared files, no interaction.

## Verification results

1. ✅ `node --check sidepanel.js` — clean. `manifest.json` parses as valid JSON.
2. ✅ `grep -n "tabs\[0\]" sidepanel.js` → 4 hits (lines 174, 320, 363, 377), **all** inside `currentWindow: true`-scoped queries.
3–6. ⏳ **Manual browser QA pending** (needs loaded unpacked extension + IG login — for the integration pass):
   - Two windows, IG Messages tab in the other window → sidepanel Open uses/creates a tab in YOUR window.
   - Pill: fresh → green/pink; 5+ min idle → amber "checking…" (recovers once T2's handler lands); no personal IG configured + browsing own account → amber "unknown", not pink.
   - Open 📅 Book overlay, trigger `loadData()` from console → overlay + slot selection survive.
   - Rapid Prev/Next through 5 leads → no snap-back.

## Integration reminders (after all 3 handoffs)

`node --check` both JS files → `npm run build` → repackage `public/extension/fanbasis-extension.zip` → `public/extension/latest.json` → **2.12.0** → Felipe uploads to Web Store (2.12.0 supersedes never-uploaded 2.11.0).
