# FIX-REPLIES · T4 — Auto-detect IG replies (no API)

**Goal:** The extension notices when a prospect replies on Instagram **on its own**, so reps never have to watch the inbox or remember to tap "Replied." A detected reply flips the lead to **Replied**, fires a notification, and jumps it to the top of the shared queue — for the whole team, off one shared FanBasis account.

**Why this and not the API:** reps won't reliably eyeball the inbox + mark replies by hand → warm leads rot. Automating the *noticing* removes that dependency. The Instagram Messaging API was rejected (business-account + Meta review not worth it; also can't send cold DMs anyway). See `project_reply_detection` decision.

**Single owner.** One cohesive change across 3 files. No terminal split — the pieces are too coupled (interceptor → relay → matcher) to hand off cleanly.

Working dir: `/Users/felipe/unified-sales-ops/chrome-extension/ig-lead-tracker`

---

## The approach — reuse what T2 already built

`background.js:298` already has a strict `CROSS_PLATFORM_REPLY` handler (from the trust fix): it takes `{ platform, detectedName, messagePreview }`, matches on **exact @handle** (no fuzzy names — that bug is fixed), records the inbound message, advances **New/Warming/DM Sent → Replied**, and fires a notification. **IG detection just feeds this same handler with `platform:"ig"`.**

So the only new work is:
1. **Detect** an inbound IG reply by reading IG's own inbox/thread poll responses (interceptor — same response-body reading it already does for viewer detection).
2. **Dedup** so the repeating background poll doesn't re-fire the same reply.
3. **Relay** it into the existing `CROSS_PLATFORM_REPLY` handler (+ one icon line).

```
page-interceptor.js  →  ig_reply CustomEvent  →  instagram.js (dedup + relay)  →  background.js CROSS_PLATFORM_REPLY (reused)
   (detect)                                          (filter/dedup)                    (match + Replied + notify)
```

---

## Files touched

| File | Change |
|------|--------|
| `page-interceptor.js` | detect inbound in `/direct_v2/inbox/` + `/direct_v2/threads/<id>/` responses → dispatch `ig_reply` |
| `instagram.js` | listen for `ig_reply`, dedup against a persisted seen-map, relay as `CROSS_PLATFORM_REPLY {platform:"ig"}` |
| `background.js` | add `ig: "📸"` to the reply notification icon map (1 line) — handler otherwise reused as-is |

---

## Tasks

### Task 1 — detect inbound replies in the interceptor (`page-interceptor.js`)

The fetch override already clones + parses JSON responses (the viewer block at ~`:50-70`), and the XHR override reads `responseText` (~`:85-102`). Add IG-DM parsing in **both** paths:

- Match URLs `/\/direct_v2\/inbox\//` and `/\/direct_v2\/threads\/\d+\//` (thread view). These are GETs — do **not** confuse with the send endpoint (`/broadcast/`, Contract A).
- Determine the **viewer id** (top-level `viewer_id` / `inbox.viewer` — verify in devtools). For each thread, take the newest item `thread.items[0]` (items are newest-first). If `items[0].user_id !== viewerId` **and** it's a message type, the last message is **inbound** = they replied.
- Extract: the other participant's **username** (from `thread.users[]` — the non-viewer user), the message text (`items[0].text` for text; for non-text use a placeholder like `"[media]"`), the `item_id`, and `thread_id`.
- Dispatch one event per inbound thread found:
  ```js
  document.dispatchEvent(new CustomEvent("ig_reply", {
    detail: { threadId, username, itemId, text },
    bubbles: true, composed: true,
  }));
  ```
- **No state here** — page-interceptor runs in the page MAIN world and has no `chrome.*` access. Detection is stateless; dedup happens in Task 2.

> ⚠️ Verify the exact JSON field paths (`inbox.threads[].items[].user_id`, `.users[].username`, `viewer_id`) in the Network tab while a real reply is open — IG renames these periodically. Guard every access with `?.` and wrap in try/catch so a shape change can never throw in the page.

### Task 2 — dedup + relay (`instagram.js`)

Mirror the existing `ig_viewer` relay (`instagram.js:60-62`) with an `ig_reply` listener:

- **Dedup (must survive service-worker restarts** — the in-memory `seenNotifIds` in background does not, per the audit). Keep a persisted map in `chrome.storage.local`:
  ```js
  // fb_seenReplies: { [threadId]: lastReportedItemId }
  ```
  On each `ig_reply`: read the map; if `fb_seenReplies[threadId] === itemId`, **skip** (already reported). Otherwise record it and relay. This makes it idempotent across polls *and* SW restarts. Prune entries older than ~30 days occasionally so it doesn't grow forever.
- **Optional tightening:** filter against the tracked-lead handle set (you already fetch leads via `GET_LEADS`) before relaying, so random non-lead inbounds don't hit the matcher. Relay-all is an acceptable fallback — the strict matcher drops non-leads (`candidates.length !== 1 → no-op`).
- **Relay** into the existing handler:
  ```js
  chrome.runtime.sendMessage({
    type: "CROSS_PLATFORM_REPLY",
    platform: "ig",
    detectedName: username,      // exact @handle → matches l.ig_username
    messagePreview: text,
  }).catch(() => {});
  ```

### Task 3 — IG notification icon (`background.js`)

The reply notification icon map (~`:356`) is `{ linkedin: "💼", twitter: "🐦" }` → IG falls through to the generic 💬. Add IG:
```js
const icon = { ig: "📸", linkedin: "💼", twitter: "🐦" }[platform] || "💬";
```
Everything else in `CROSS_PLATFORM_REPLY` is reused unchanged — matching, inbound-message POST (`channel:"ig"`), the `New/Warming/DM Sent → Replied` stage flip, and the `LEAD_UPDATED` broadcast that jumps the lead in open tabs.

---

## What you get / accepted limits

- **Nobody has to watch.** Whenever *any* rep has a FanBasis tab open (all workday, since they send from it), IG background-polls its own inbox → the interceptor catches new inbound → auto-Replied + notify + jump to top of the shared queue. Team-wide coverage off one account.
- **Handling stays loose.** No per-rep assignment (decided) — the reply just surfaces loudly; whoever grabs it, grabs it. The shared "Replied" stage means it won't be re-worked as cold.
- **Accepted limit:** only fires while a FanBasis tab is open somewhere. A 2am reply with all tabs closed surfaces when someone next opens FanBasis (a delay, not a miss — the unread is still there). True live-overnight would need the API, which is skipped.
- **Manual "Replied" button stays** on the floating card + sidepanel as a backup for anything detection misses.

## Test checklist (load unpacked, real IG)
- [ ] Have a lead reply to the FanBasis account → within a poll cycle (no manual action) the lead flips to **Replied**, a 📸 notification fires, and it jumps to the top of the queue.
- [ ] Leave the tab open across several poll cycles → the same reply does **not** re-notify (dedup works).
- [ ] Reload the extension (kills the SW), keep the reply unread → it still doesn't duplicate (persisted dedup survives restart).
- [ ] An inbound from a **non-lead** does nothing (strict matcher drops it).
- [ ] Opening a lead's DM thread directly also detects the reply (thread endpoint path).
- [ ] `node --check page-interceptor.js instagram.js background.js` passes.

## Done when
IG replies auto-flip tracked leads to Replied + notify + surface, with no rep action and no duplicates across polls or SW restarts. Manual button intact as backup. Commit + push; live-IG run confirms the checklist.
