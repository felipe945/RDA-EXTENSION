# HANDOFF — IGOPEN Terminal 2 (content script)

**Status: COMPLETE.** All 8 builds applied to `chrome-extension/ig-lead-tracker/instagram.js` — the only file touched. `node --check` clean; both grep criteria at zero.

## What changed (by build)

1. **`openIgDm` — no more Messages-inbox dead end.** The exhausted-retries branch no longer navigates to the retired `/direct/new/?username=` endpoint (and no longer sets `fb_auto_dm_confirm`). Instead: if we're not on the target profile, set a one-shot `fb_dm_retry` flag (`username|timestamp`, 2-min expiry) and navigate to the profile; `updateCardForProfile` consumes the flag on arrival and calls `openIgDm` once more. If the Message button still isn't found *on* the profile, `showDmFallbackNotice(username)` shows an amber toast — "Couldn't auto-open the DM — tap **Message** on @handle. Your opener is on the clipboard." Flag is cleared before the retry call, so a failed retry lands in the notice branch — at most one automated retry, never a loop.
2. **Switcher exact-token matching.** `watchSwitchMenu`'s `pick_account` phase now does a two-pass match: exact handle token first (split on whitespace/`@`/`·` — `john` no longer matches `johnsmith`); `.includes` only as a display-name fallback and only when exactly ONE row matches. Ambiguous → no auto-click, rep clicks manually.
3. **Listener-leak fix.** Module-level `activeSwitchCleanup` registry; `renderSwitchPrompt` registers its `cleanup` there and `removeCard()` calls it on teardown, so navigating away mid-prompt removes the `chrome.storage.onChanged` watcher (no phantom "switch complete"). Existing `storageCleanedUp` idempotence kept as the race guard.
4. **`saveLead` sends canonical `profileUrl`** (`https://www.instagram.com/<handle>/`) alongside the untouched `pageUrl`.
5. **Username-first navigation, all 4 spots** (completeBothSends next-button, navigateToNextLead snooze/skip/next, renderComplete afterSend next-button): `ig_username ? canonical URL : ig_profile_url`. In `navigateToNextLead` the expression is extracted to a single `nextUrl` const used by all three buttons. `grep "ig_profile_url ||"` → 0 hits.
6. **`FB_RECHECK_ACCOUNT` handler added** to the existing `chrome.runtime.onMessage` listener — dispatches `ig_viewer_check` for a fresh viewer detection. Contract with T3 honored, name unchanged.
7. **Pending-DM single-redirect guard.** First mismatch sets `pending.redirected = true` (persisted via `_writePending`) and bounces once; a second mismatch means the rep deliberately went elsewhere → `clearPendingDm()`, stop fighting them. On-profile consumption branch unchanged.
8. **SPA watcher.** The 800 ms `setInterval(handleUrlChange)` poll now runs ONLY when `window.navigation` is absent (else-branch of the Navigation API listener).

## Deviations from the plan (all minor, all safer)

- **BUILD 1 comment reworded**: the plan's suggested comment contained the literal `direct/new`, contradicting its own "grep → zero hits" criterion. Same meaning, different words.
- **BUILD 1 retry flag**: implemented the plan's optional timestamp variant (`username|ts`, 2-min expiry) via three small helpers (`getDmRetryUsername`/`setDmRetry`/`clearDmRetry`) instead of a bare string — survives-stale-flag safety. Also guarded `username` with `String(username || "")` so a null username (possible via `CLICK_DM_BTN` off-profile) shows the notice instead of navigating to `/undefined/`.
- **BUILD 7**: used the existing `_writePending(pending)` helper instead of the plan's raw `localStorage.setItem`, so the `redirected` flag also persists to the `chrome.storage.local` backup (Layer C) — otherwise a full-page reload restoring from backup would lose the flag and could bounce twice.
- **`showDmFallbackNotice`**: renders inside the FB card when present (margin style), else as a fixed top-right toast; auto-dismisses after 12 s; reuses the injected `fb-in` keyframe from `injectStyles`. No `styles.css` touched.
- **Not removed (out of scope)**: `fb_auto_dm_confirm` consumption at startup and `autoConfirmIgDialog` remain — the dialog helper has another live caller (line ~1749 send flow); only `openIgDm` stopped setting the flag.

## Verification results

- `node --check chrome-extension/ig-lead-tracker/instagram.js` → clean.
- `grep -c "direct/new" instagram.js` → **0**. `grep -c "ig_profile_url ||" instagram.js` → **0**.
- Live checks (plan steps 3–5: load unpacked, hidden-Message-button test, mid-prompt navigation phantom test, POST body `profileUrl`) **not run here** — need a browser + IG session; belongs to the post-handoff integration pass.

## Files touched
- `chrome-extension/ig-lead-tracker/instagram.js` only. `manifest.json`, `sidepanel.js`, `styles.css`, dashboard files untouched, per plan.

## For integration
- T3's `FB_RECHECK_ACCOUNT` sender has its handler ready (BUILD 6).
- After all three handoffs: `node --check` both JS files, repackage `public/extension/fanbasis-extension.zip`, bump `public/extension/latest.json` → 2.12.0 (T3 owns the manifest bump).
