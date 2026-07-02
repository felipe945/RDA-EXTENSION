# FIX-REPLIES · T3 Summary — MATCH + SURFACE + SERVER IDEMPOTENCY

**Status: ✅ DONE + SHIPPED** (2026-07-02) · Files owned: `background.js`, `app/api/messages/route.ts` (+ migration `013`)
**Integration run:** T2 committed (`073a184`), manifest bumped `2.0.0→2.1.0`, pushed to `origin/main` (`690ee05`). **Migration `013` applied via Supabase SQL editor + verified live** (PostgREST returns `item_id`/`thread_id`, HTTP 200, no `42703` — schema cache fresh, server dedup active, no fallback).

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

## Done during integration (2026-07-02)

- ✅ T2 committed (`073a184`), wave docs committed (`690ee05`), pushed to `origin/main`.
- ✅ Manifest bumped `2.0.0 → 2.1.0`.
- ✅ Migration `013` applied (SQL editor — CLI blocked: not logged in + no DB password on this machine) and verified: PostgREST sees `item_id`/`thread_id` (HTTP 200, no `42703`), so cross-rep dedup is enforced at the DB, not falling back.

## Remaining — all human-only, no code left

1. **Verification step 0** (gates the rollout promise; ~2 min, needs a logged-in IG session). Devtools → Network on a live IG tab:
   - Confirm T1's field paths still hold: `viewer.pk`/`thread.viewer_id`, `thread.users[].username`, `items[].user_id/.item_id/.item_type/.text`. Report back → confirm map or patch.
   - Sit on the **feed** (not `/direct/`), have someone reply: does a background request return `items[]`, or only a badge count? If badge-only, correct the promise to "detects when a rep opens the inbox/a thread," not "from any open tab."
2. **Web Store upload of the 2.1.0 build** — the git push does NOT ship to reps; the Unlisted-store upload does. Do this *after* step 1 so field paths aren't stale on ship.
3. **Two-browser live test** (now unblocked — migration is live): two profiles on the shared account, one lead replies → exactly **one** inbound row + DM Sent→Replied flip + 📸 notify. Plus the rest of the end-to-end checklist at the bottom of `FIX_REPLIES_T3_MATCH.md`.
