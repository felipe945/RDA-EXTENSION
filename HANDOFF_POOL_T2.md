# HANDOFF — POOL Terminal 2: EXTENSION (per-rep personal touches, FanBasis-only marking)

Status: **COMPLETE** — all six BUILDs implemented, static verification clean. Live browser QA deferred to integration (see bottom).

Files touched (only these, all under `chrome-extension/ig-lead-tracker/`):
`background.js`, `instagram.js`, `sidepanel.js`, `manifest.json` (version → 2.13.0 only).
No dashboard files, no page-interceptor.js / popup.js / sidepanel.html / styles.css / outreach-queue.js.

---

## What was built

### BUILD 1 — background.js: `TOUCH_LEAD` message
- New `case "TOUCH_LEAD"` inserted after `UPDATE_LEAD`, mirroring its bearer/fetch/async-sendResponse conventions: `POST {dashboardUrl}/api/leads/touch` with `{ leadId, channel, sent: msg.sent !== false }`, bearer repToken. No rep identity is ever sent from the client.
- On success: optimistic in-memory cache update (`target.outreach_channels = data.outreach_channels`, persisted to `fb_cache` — same pattern as `SNOOZE_LEAD`), `LEAD_UPDATED` broadcast to open IG tabs, `setTimeout(refreshCache, 1500)`, responds `{ ok: true, outreach_channels }`. On failure: `{ ok: false, error }` — chips just don't persist, no crash (pre-T1 404 behaves this way).
- Rep-id passthrough: background `GET_SETTINGS` **already** exposed `rep: boot?.rep || null` — no change needed there. instagram.js `getSettings()` was extended (see BUILD 4).

### BUILD 2 — instagram.js: `markChannelSent` → server-stamped touch
- Replaced the whole-object `PATCH /api/leads {outreach_channels}` with
  `markChannelSent(leadId, channel, sent = true)` → `chrome.runtime.sendMessage({type:"TOUCH_LEAD", id, channel, sent})`, resolving to the server-merged `outreach_channels` or `null`.
- All call sites updated, dead `current`/`dashboardUrl` args dropped:
  - `commitSent` (~1815): removed the `getSettings()` wrapper; still fires `FB_DM_SENT` after the touch persists.
  - `completeBothSends` (~2053-2054): both channels via the new signature.
  - Chip persistence (~2644/2655): now via `markChannelSent` (see BUILD 4).
  - Two NEW call sites in the gated quick-mark buttons (see BUILD 3 deviation D2).

### BUILD 3 — stage "DM Sent" only on FanBasis sends
All remaining `stage:"DM Sent"` writes in the extension are now gated or kept-by-design:
- `completeBothSends` (instagram.js ~2052) — **kept** (always includes a FanBasis send). Comment added.
- Second-touch completions (instagram.js ~2456 renderSaved, ~2839 renderComplete) — gated on `autoDm === "ig_fanbasis"` (`autoDm` IS the second touch's channel, restored from `pendingDm.channel`). Personal-second leaves stage alone; the FanBasis first touch already advanced it via the (now gated) FB_DM_SENT handler.
- Quick-mark buttons "✓ Mark Sent" (renderSaved ~2410) and "✓ DM Sent" (renderComplete ~2670) — gated via a new `detectActiveSendChannel()` helper (see deviation D2).
- **background.js `FB_DM_SENT` handler** — its stage-advance PATCH (`stage:"DM Sent"` + `last_contact_at` + `due_at` when stage ∈ New/Warming) is now gated on `channel === "ig_fanbasis"` (see deviation D1). Touchpoint logging, tab broadcast, and cache refresh still run for personal sends.
- No optimistic "DM Sent" painting was found for personal sends; cards re-render from the refreshed cache via the existing `LEAD_UPDATED` → `updateCardForProfile()` path (TOUCH_LEAD broadcasts it too).

### BUILD 4 — instagram.js: chips read MY personal state
- `getSettings()` now returns `rep: boot?.rep || null` and stashes it in a module-level `myRep` (refreshed on every call; `getSettings()` runs before each card render). This is the background-cached `fb_bootstrap` passthrough — no new storage guesswork.
- Chip init (renderComplete): `persChipDone = myRepId ? !!outreachChannels.ig_personal_by?.[myRepId]?.sent : !!(outreachChannels.ig_personal?.sent)` — legacy aggregate only as the signed-out fallback.
- `renderChannelTracker` Personal pill likewise reads MY `ig_personal_by` entry (legacy fallback when no rep id). FanBasis pill unchanged (team-shared).
- `chTime()` made tolerant of ISO-string `sentAt` (server now stamps it; legacy client wrote epoch ms).
- Plan pointer note: the "second-touch prompt logic (~1943 isOnPers / ~2062 crossChannelIntro)" does NOT consult outreach_channels — it detects the currently ACTIVE IG account, not "has the personal touch happened". Verified by grep: `ig_personal?.sent` appeared only at the chip init. Nothing to change there.

### BUILD 5 — sidepanel.js: same per-rep read + TOUCH_LEAD writes
- New global `myRepId`, set in `loadData()` from `GET_SETTINGS`' `s.rep?.id`.
- Backend sync (~867-872): personal chip syncs from `outreachChs.ig_personal_by?.[myRepId]?.sent`, legacy `ig_personal?.sent` only when signed out. Rep B no longer inherits rep A's personal touch.
- fbChip/persChip click handlers: persist via `TOUCH_LEAD` with `sent: newVal` (un-toggle supported), plus an optimistic in-memory `lead.outreach_channels` update so the sync block doesn't flip an un-toggled chip back before the refreshed cache lands.
- "Open LinkedIn" auto-mark and the LinkedIn branch of Mark-Sent: switched from whole-object `UPDATE_LEAD {outreach_channels}` to `TOUCH_LEAD {channel:"linkedin"}` (see flag F1).
- `markSentBtn`: personal-only chip state (pers ✓, fb ○, IG queue) → green toast "Personal touch saved — lead stays queued until the FanBasis DM" and **no stage/due write, no queue removal**. Otherwise stage write proceeds as before, but WITHOUT the old bundled `outreach_channels` merge (chips already persisted their touches per-rep at click time).
- Log pills (nice-to-have, done): Personal pill lists per-rep names from `ig_personal_by` ("📸 Pers. ✓ Cam, Felipe · 2h ago"), legacy pill as fallback; FanBasis pill shows `byName` when present.

### BUILD 6 — manifest.json
- `"version": "2.13.0"`. Nothing else touched.

---

## Deviations from the plan (and why)

- **D1 — background.js FB_DM_SENT stage gate (not in the plan's numbered builds).** The plan's four instagram.js sites weren't the only stage movers: background's `FB_DM_SENT` handler unconditionally advanced New/Warming leads to "DM Sent" + set due_at for ANY channel — a personal send would have moved stage through this side door, violating the locked rule. Gated on `channel === "ig_fanbasis"`. This is required by the plan's own BUILD 3 rule text ("Personal-only sends still fire FB_DM_SENT … but must NOT include stage-moving updates") and it's also what makes the FanBasis-FIRST touch advance stage in the two-touch flow (so gating the second-touch site is safe).
- **D2 — quick-mark buttons had NO channel in scope.** Plan sites ~2384/~2622 are the "✓ Mark Sent"/"✓ DM Sent" quick-mark buttons, not send-confirm paths — there is no `opts.channel` there. Implemented a `detectActiveSendChannel()` helper (same trusted sources as the send wizard: fresh `activeIgAccount` per Contract B, else live DOM detection, matched against `fanbasisHandle`/`personalIgUsername`): detected personal → records MY personal touch via `markChannelSent`, button shows "✓ Personal", stage/due untouched, lead stays queued; detected FanBasis → also records the ig_fanbasis touch (new — these buttons previously recorded no touch), then the stage write proceeds; **undetected → stage write proceeds as before** (the button's explicit purpose) with no touch recorded (identity unknown, nothing fabricated).
- **D3 — instagram.js chips support un-toggle now.** They previously only persisted toggle-ON; both surfaces now pass `sent:false` on un-toggle for consistency with the sidepanel requirement.
- **D4 — sidepanel Mark-Sent no longer writes the neutral `ig` stamp** (old no-chip case). Nothing anywhere read `outreach_channels.ig`, and composing it client-side is exactly the clobber TOUCH removes. No-chip clicks still move stage (explicit rep attestation, and the hint text already tells reps to mark chips first).
- **D5 — dead `opts.outreachChannels` plumbing removed** where it existed purely to feed the old markChannelSent (commitSent, renderComplete's showDmPreview call). No behavior change.

## Flags for T1 / integrator

- **F1 — `linkedin` channel now goes through `/api/leads/touch`.** The sidepanel's LinkedIn auto-mark + LinkedIn Mark-Sent send `TOUCH_LEAD {channel:"linkedin"}`. Contract TOUCH only names `ig_fanbasis | ig_personal`. The endpoint should accept `"linkedin"` as a simple aggregate merge (`{sent, sentAt}`, no per-rep map needed); if it rejects it, LinkedIn touch persistence silently stops (no crash) — but leaving the old whole-object PATCH would have clobbered `ig_personal_by`, so this is the safer failure mode either way.
- **F2 — `sentAt` format:** extension display helpers now accept both epoch-ms (legacy client writes) and ISO strings (whatever the server stamps). No constraint on T1's choice.
- **F3 — TOUCH_LEAD response is trusted for optimistic cache:** background writes `data.outreach_channels` straight into `fb_cache`. The endpoint must return the FULL merged `outreach_channels` (per contract), not a delta.
- **F4 — pre-T1 testing:** with the endpoint 404ing, TOUCH_LEAD resolves `{ok:false}`; chips paint optimistically in the open card but don't persist and revert on next render — as the plan predicted.
- scripts-data.js (not owned) only holds channel LABEL constants — no touch-state reads. outreach-queue.js/popup.js/page-interceptor.js read no outreach_channels.

## Verification results

1. `node --check instagram.js && node --check sidepanel.js && node --check background.js` — **clean**; `manifest.json` JSON-parses, version **2.13.0**.
2. `grep -n "outreach_channels: updated\|outreach_channels: {" instagram.js sidepanel.js` — **empty** (no client-composed whole-object writes remain; TOUCH_LEAD only).
3. All remaining `stage:"DM Sent"` writes audited (grep across the three files): background FB_DM_SENT (gated ig_fanbasis), sidepanel markSentBtn (gated: personal-only early-returns), instagram completeBothSends (kept by design), two second-touch sites (gated `autoDm === "ig_fanbasis"`), two quick-mark buttons (gated via detectActiveSendChannel).
4. **Live QA (plan steps 3-6) NOT run — deferred to integration** per instructions: load unpacked + signed in, (a) personal send → stage unchanged, still queued, DB `ig_personal_by.<me>` set, `ig_fanbasis` untouched; (b) FanBasis send → stage "DM Sent", `ig_fanbasis.byName` = sender, leaves queue; (c) two-profile test → rep B's Personal chip empty where rep A touched; (d) legacy `ig_personal` aggregate derived server-side after (a).

## Integration steps (after both handoffs)

- `npm run pack:ext` + `npm run pack:webstore` (2.13.0) — regenerates `outreach-queue.js` bundle copy; commit + push; Felipe uploads the webstore zip (supersedes 2.12.0 if not yet uploaded).
