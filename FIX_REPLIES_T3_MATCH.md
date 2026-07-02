# FIX-REPLIES · Terminal 3 — MATCH + SURFACE + SERVER IDEMPOTENCY

**You own: `background.js` and `app/api/messages/route.ts`.** Do not touch `page-interceptor.js` (T1) or `instagram.js` (T2). You are the convergence point — you also run the final integration (bottom of this file).

Working dir: `/Users/felipe/unified-sales-ops` (extension at `chrome-extension/ig-lead-tracker`)

---

## Shared contracts (FROZEN — same block in all 3 files)

**Contract R2 — `CROSS_PLATFORM_REPLY` runtime message (T2 → YOU).** T2 now sends two NEW fields you must consume:
```js
{ type:"CROSS_PLATFORM_REPLY", platform:"ig", detectedName, messagePreview, itemId, threadId }
```

---

## Context: the existing handler you're extending
`background.js:299-368` `CROSS_PLATFORM_REPLY` already: strict exact-`@handle` match on `l.ig_username` (`:314-321`), POSTs an inbound message (`:327`), advances `New/Warming/DM Sent → Replied` (`:340-346`), broadcasts `LEAD_UPDATED` (`:347-351`), notifies (`:354-360`). **Most of your job is reusing it — with three corrections.**

---

## Tasks

### Task 1 — IG notification icon (the quick one)
`:354` is `{ linkedin: "💼", twitter: "🐦" }[platform] || "💬"` → IG falls to 💬. Add IG:
```js
const icon = { ig: "📸", linkedin: "💼", twitter: "🐦" }[platform] || "💬";
```
Note: `:171` already has `ig:"📸"` — that's a DIFFERENT map (the notification-*poll* path). Yours is `:354` inside `CROSS_PLATFORM_REPLY`. Don't confuse them.

### Task 2 — surface EVERY inbound, not just the first (the important one)
Today the `LEAD_UPDATED` broadcast is **nested inside the `EARLY_STAGES` if-block** (`:341-352`). So only the *first* reply (which flips DM Sent→Replied) refreshes open tabs. A **follow-up** reply from a lead already in `Replied`/`Qualifying` ("you there? what's the price?") records a message and notifies, but **never broadcasts `LEAD_UPDATED`** → open sidepanels don't refresh. Live IG conversations are mostly follow-ups, and those are the most time-sensitive.

Restructure so surfacing happens on **every** matched inbound:
```js
if (matched) {
  // 1. record inbound (Task 3 idempotency)
  // 2. advance stage ONLY if early:
  const EARLY_STAGES = ["New", "Warming", "DM Sent"];
  if (EARLY_STAGES.includes(matched.stage)) { /* PATCH stage → Replied */ }
  // 3. ALWAYS broadcast LEAD_UPDATED (move it OUT of the if) so every reply refreshes tabs
  chrome.tabs.query({ url: "https://www.instagram.com/*" }, (tabs) => {
    for (const tab of (tabs||[])) chrome.tabs.sendMessage(tab.id, { type:"LEAD_UPDATED", leadId: matched.id }).catch(()=>{});
  });
  // 4. notify (Task 1 icon)
}
```

### Task 3 — server-side idempotency (kills cross-rep duplicate rows)
The shared FanBasis account means **N reps each detect the same reply** and each fires a `CROSS_PLATFORM_REPLY` → today `:327` POSTs **N identical inbound rows** to `/api/messages` (per-browser dedup in T2 can't see other reps). Fix at the server:
- Forward the key from the handler: include `item_id: msg.itemId` (and optionally `thread_id`) in the `/api/messages` POST body (`:330-336`).
- In `app/api/messages/route.ts`: treat `(lead_id, channel, item_id)` as a uniqueness key — upsert / no-op on conflict instead of inserting a dup. (Add a partial unique index or a pre-insert existence check, whichever fits the schema. If `item_id` is null — e.g. non-IG callers — fall back to current insert behavior.)
- This also hardens against SW-restart re-fires for free.

### Task 4 — CORRECT the "jumps to top of queue" language (design reality)
`outreach-queue.js:5` puts **`Replied` in `DONE_STAGES`**, and `buildQueue` (`:37`) **filters `DONE_STAGES` OUT**. So a reply does **NOT** "jump to the top of the outreach queue" — it *leaves* that queue (correct: the outreach queue is for cold DMs still to send). The reply must instead surface in the **reply-inbox** surface (`sidepanel.js` `inboxBadge`, ~`:1102`).
- Verify `LEAD_UPDATED` (now firing on every reply, Task 2) actually refreshes the reply-inbox list + bumps `inboxBadge`, ordered by recency (most-recent reply on top). If the inbox sorts by score like the outreach queue, it won't surface newest-first — fix the inbox sort to recency, or add an `updated_at` bump on the reply so it rises.
- Do NOT try to force Replied leads back into `buildQueue` — that would break the cold-DM queue's whole purpose and the batch-% math (`computeBatchProgress`).

---

## Test checklist (T3)
- [ ] `CROSS_PLATFORM_REPLY {platform:"ig", detectedName:"<a real lead handle>", itemId, threadId}` → lead flips DM Sent→Replied, 📸 notification, inbound row recorded once.
- [ ] Same message replayed from a SECOND browser/profile (simulating another rep) → **still one** inbound row (server idempotency), not two.
- [ ] A follow-up (new itemId, lead already Replied) → inbound recorded + `LEAD_UPDATED` fires + reply-inbox refreshes; stage stays Replied (Task 2).
- [ ] Non-lead handle → no-op (`candidates.length !== 1`).
- [ ] Replied lead is gone from the outreach queue but present/topmost in the reply inbox (Task 4).
- [ ] `node --check background.js` passes; dashboard route builds.

## Done when
IG replies match, record exactly once cross-rep, surface on EVERY reply (not just first), land in the reply inbox newest-first, and notify with 📸.

---

## Integration — run AFTER T1, T2, T3 all land (T3 drives this)
1. Merge all three (no file overlap → no conflicts by construction).
2. **Bump `manifest.json` `version`** `2.0.0 → 2.1.0`. Without this the team's Chrome Web Store (Unlisted) installs won't auto-update to the new build — see `project_extension_rollout`. This step is easy to forget and silently ships nothing to reps.
3. Load unpacked, real IG, full end-to-end checklist:
   - [ ] Lead replies → within a poll cycle: auto-Replied, 📸 notify, appears in reply inbox, **no manual action**.
   - [ ] Same reply across several poll cycles → no re-notify (T2 dedup).
   - [ ] Reload extension (kills SW), reply still unread → no duplicate (persisted dedup).
   - [ ] Two browsers signed into the shared account → one inbound row, not two (T3 server idempotency).
   - [ ] Follow-up reply from an already-Replied lead → surfaces + notifies (Task 2).
   - [ ] Reaction / your own outbound → nothing (T1 filters + viewer guard).
   - [ ] Manual "Replied" button still works as backup.
4. Fold T1's **verification-step-0 findings** into the promise wording (passive-vs-on-view). Commit + push.
