# FIX-REPLIES · T3 Summary — MATCH + SURFACE + SERVER IDEMPOTENCY

**Status: ✅ DONE** (2026-07-02) · Files owned: `background.js`, `app/api/messages/route.ts` (+ new migration `013`)
**Not yet run: integration** (waiting on T2 to commit) · **One manual step: migration 013 in Supabase SQL editor**

---

## What changed

### Task 1 — 📸 IG notification icon ✅
`background.js:354` icon map inside `CROSS_PLATFORM_REPLY` now includes `ig: "📸"`:
```js
const icon = { ig: "📸", linkedin: "💼", twitter: "🐦" }[platform] || "💬";
```
The other `ig:"📸"` map at `:171` (notification-*poll* path) is a different map and was not touched.

### Task 2 — surface EVERY inbound, not just the first ✅
The `LEAD_UPDATED` broadcast was nested inside the `EARLY_STAGES` if-block, so only the first reply (the DM Sent→Replied flip) refreshed open tabs. Restructured:

1. Record inbound (now with `item_id`/`thread_id` — Task 3)
2. PATCH stage → Replied **only if** stage ∈ `["New", "Warming", "DM Sent"]` (unchanged)
3. **ALWAYS** broadcast `LEAD_UPDATED` to IG tabs (moved out of the if)
4. Notify with the Task-1 icon

Follow-up replies from already-Replied/Qualifying leads ("you there? what's the price?") now refresh open tabs. Safe: the only `LEAD_UPDATED` listener (`instagram.js:2552`) just refreshes the profile card + reply-relay prefilter — idempotent.

### Task 3 — server-side idempotency (kills cross-rep duplicate rows) ✅
The shared FanBasis account means N reps detect the same reply → N identical POSTs. Fixed at the server, where all reps converge:

- **`background.js`**: `CROSS_PLATFORM_REPLY` destructures `itemId`/`threadId` (Contract R2) and forwards them as `item_id`/`thread_id` in the `/api/messages` POST body (null-safe if T2 fields absent).
- **`app/api/messages/route.ts` POST**: `(lead_id, channel, item_id)` is the uniqueness key.
  - Pre-insert existence check → duplicate returns `200 { deduped: true }` with the existing row (no new row).
  - `23505` unique-violation catch → handles the two-reps-insert-simultaneously race; returns the winner's row.
  - No `item_id` (SMS/email/older extension) → exact legacy insert behavior.
  - Column missing (migration 013 not yet applied) → logs `item_id dedup unavailable`, strips the new fields, falls back to legacy insert. **Deploy order doesn't matter.**
- **`supabase/migrations/013_messages_item_id_idempotency.sql`** (new): adds `item_id text`, `thread_id text` + partial unique index `messages_lead_channel_item_uniq on (lead_id, channel, item_id) where item_id is not null`.

Also hardens against SW-restart re-fires for free.

### Task 4 — "jumps to top of queue" language corrected ✅ (verification, no code change needed)
Design reality confirmed: `Replied` is in `DONE_STAGES` (`outreach-queue.js:5`) so a reply **leaves** the outreach queue (correct — that queue is cold DMs still to send). The reply surfaces in the **reply inbox** instead, and that path was verified already-correct:

- `/api/notifications` sorts inbound messages **newest-first by `created_at`** → follow-ups rise to the top. No sort fix needed.
- Sidepanel inbox badge + list refresh on **every** matched reply via the existing `refreshCache → fb_cache storage change → loadData` chain (fires 2.5s after each match, independent of stage).
- Did NOT force Replied leads into `buildQueue` — preserves cold-DM queue purpose and `computeBatchProgress` math.
- No "jumps to top of queue" wording exists in code — it was planning-doc-only. Fold into promise wording at integration (step 4).

---

## Verification done

| Check | Result |
|---|---|
| `node --check background.js` | ✅ passes |
| `npm run build` (dashboard) | ✅ `/api/messages` compiles; only noise is stale `.next` artifacts from the removed `/summary` page (pre-existing) |
| Legacy POST path (no `item_id`), live dev server | ✅ behaves exactly as before (tested with bogus lead_id → FK 500, no prod rows created) |
| Pre-migration fallback (`item_id` sent, column missing) | ✅ logs `item_id dedup unavailable: column messages.item_id does not exist`, falls back to legacy insert — no crash |
| `LEAD_UPDATED` listeners tolerate extra broadcasts | ✅ `instagram.js:2552` — card refresh + prefilter refresh, idempotent |
| Inbox sorts newest-first / badge bumps | ✅ verified by code-path reading (`/api/notifications` + `sidepanel.js:1102`) |

### Still needs live testing (blocked until migration + T2 + real IG session)
- [ ] Real `CROSS_PLATFORM_REPLY` → DM Sent→Replied flip, 📸 notify, one inbound row
- [ ] Replay from second browser/profile → **still one row** (needs migration 013 applied)
- [ ] Follow-up (new itemId, already-Replied lead) → recorded + inbox refresh, stage stays Replied
- [ ] Replied lead gone from outreach queue, topmost in reply inbox

---

## Remaining work (in order)

1. **Felipe — run migration 013** in the Supabase SQL editor (`supabase/migrations/013_messages_item_id_idempotency.sql`). No CLI/psql on this machine. Until applied, dedup silently falls back to plain insert (cross-rep dupes possible, nothing breaks).
2. **Wait for T2 to commit** — its `instagram.js` relay is in the working tree but uncommitted (T1 landed as `cc7dac1` mid-session).
3. **Integration (T3 drives):**
   - Bump `manifest.json` version `2.0.0 → 2.1.0` (without this, Chrome Web Store Unlisted installs won't auto-update — silently ships nothing to reps)
   - Load unpacked, real IG, full end-to-end checklist (bottom of `FIX_REPLIES_T3_MATCH.md`)
   - Fold T1's verification-step-0 findings (passive-vs-on-view detection) into the promise wording — **step 0 still needs a rep in devtools**
   - Commit + push
