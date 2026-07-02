# FIX-REPLIES · Terminal 2 — DEDUP + RELAY (instagram.js)

**You own ONE file: `instagram.js`.** Do not touch `page-interceptor.js` (T1) or `background.js` (T3). You are the middle of the pipe: consume Contract R1, produce Contract R2.

Working dir: `/Users/felipe/unified-sales-ops/chrome-extension/ig-lead-tracker`

---

## Shared contracts (FROZEN — same block in all 3 files)

**Contract R1 — `ig_reply` CustomEvent (T1 → YOU).** You listen for this.
```js
detail = { threadId, username, itemId, text, itemType }
// username = exact @handle, lowercase, no leading @. itemId = dedup key. Emitted once per new inbound item.
```

**Contract R2 — `CROSS_PLATFORM_REPLY` runtime message (YOU → T3).** You send this. **Note the two NEW fields** `itemId`/`threadId` — T3 uses them for server-side idempotency, so you MUST pass them:
```js
chrome.runtime.sendMessage({
  type: "CROSS_PLATFORM_REPLY",
  platform: "ig",
  detectedName: username,   // → T3 matches exact on l.ig_username
  messagePreview: text,
  itemId,                   // NEW — idempotency key
  threadId,                 // NEW — idempotency key
}).catch(() => {});
```

---

## Context: the pattern to mirror
`instagram.js:60-64` already relays `ig_viewer` → `IG_VIEWER`. Add an `ig_reply` listener right beside it, same shape. `GET_LEADS` is already used elsewhere (`:597`) if you want the optional handle filter (Task 3).

---

## Tasks

### Task 1 — listen for `ig_reply` and relay per Contract R2
Add next to the `ig_viewer` listener (~`:64`):
```js
document.addEventListener("ig_reply", (e) => {
  const d = e.detail || {};
  if (!d.username || !d.itemId || !d.threadId) return;   // malformed → drop
  handleIgReply(d);   // dedup + relay (below)
});
```

### Task 2 — persisted dedup that survives service-worker restarts
The background's in-memory `seenNotifIds` (`background.js:140`) is wiped on SW restart — do NOT rely on it. Keep your own persisted map in `chrome.storage.local`. **Store a timestamp** so the prune in Task 4 is actually possible (the original plan's `{threadId:itemId}` shape had no time, so its "prune 30 days" was impossible):
```js
// fb_seenReplies: { [threadId]: { itemId, ts } }
```
`handleIgReply(d)`:
1. `chrome.storage.local.get({ fb_seenReplies: {} })`.
2. If `map[d.threadId]?.itemId === d.itemId` → **skip** (already reported; idempotent across polls AND SW restarts).
3. Else `map[d.threadId] = { itemId: d.itemId, ts: Date.now() }`, `set`, then relay (Task 3/R2).

> This dedups within ONE browser only. Cross-rep duplication (5 reps on the shared account each detecting the same reply) is handled server-side by T3 via `itemId` — that's why you must forward `itemId`. Don't try to solve cross-rep here.

### Task 3 — relay (Contract R2), with an optional lead-handle prefilter
Relay exactly per Contract R2 above. **Optional tightening:** you already fetch leads via `GET_LEADS`; keep a cached lowercased handle set and skip relaying inbounds whose `username` isn't a tracked lead — cuts noise from random inbounds. Relay-all is an acceptable fallback because T3's matcher drops non-leads (`candidates.length !== 1 → no-op`). If you add the filter, refresh the set on `LEAD_UPDATED`/periodically so a freshly-added lead isn't missed.

### Task 4 — occasional prune
When writing the map, drop entries with `ts` older than ~30 days so it can't grow forever. One entry per thread means it stays tiny regardless, but do it anyway for hygiene.

---

## Test checklist (T2 — you can stub T1 by dispatching `ig_reply` from the console, and watch the `CROSS_PLATFORM_REPLY` go out)
- [ ] Dispatch an `ig_reply` → exactly one `CROSS_PLATFORM_REPLY` sent with `itemId`+`threadId` present.
- [ ] Dispatch the SAME `{threadId,itemId}` again → **no** second relay (dedup).
- [ ] Reload the extension (kills SW), dispatch the same one → still **no** relay (persisted dedup survives restart).
- [ ] A NEW `itemId` on the same `threadId` → relays (follow-up replies get through).
- [ ] Malformed detail (missing itemId) → dropped, no throw.
- [ ] `node --check instagram.js` passes.

## Done when
Every distinct inbound item relays exactly once per browser as Contract R2 (with `itemId`/`threadId`), dedup survives poll repeats and SW restarts, map is pruned, no throw on malformed input.
