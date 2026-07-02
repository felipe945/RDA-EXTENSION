# FIX-REPLIES · T1 Summary — DETECT (`page-interceptor.js`)

**Status: ✅ DONE** — commit `cc7dac1` (2026-07-02), one file touched: `chrome-extension/ig-lead-tracker/page-interceptor.js` (+97 lines).

Real inbound IG DMs now emit an `ig_reply` CustomEvent per Contract R1, which T2 (instagram.js) consumes, dedups, and relays to T3 (background.js).

---

## What was built

### 1. DM reads intercepted in BOTH network paths
- **New `isDmReadUrl()`**: matches GET requests to `/direct_v2/inbox/` and `/direct_v2/threads/<digits>/`. The `broadcast` endpoint (outbound send, Contract A) is explicitly excluded and can never be treated as a read.
- **fetch path**: DM parsing runs in its own branch *before* the existing viewer-detection block — necessary because that block early-`return`s after finding a viewer, which would have silently skipped DM parsing.
- **XHR path**: `/direct_v2/` was absent from the old response-reading allowlist (`current_user | graphql | api/v1/feed`), so it got its own branch in the `load` handler.

### 2. Shared-account safety guard (Task 2)
Viewer id is required from the response itself (`viewer.pk` on inbox responses, `thread.viewer_id` on thread responses) before any message is classified. **No known viewer id → zero events.** Without this, `item.user_id !== undefined` is always true and reps' own outbound DMs on the shared FanBasis account would flip leads to Replied and flood notifications.

### 3. Real messages only (Task 3)
Allowlist of `item_type`s: `text, media, clip, voice_media, raven_media, animated_media, link, share, story_share`. Reactions, "seen" markers, likes, and `action_log` entries are dropped — a prospect's 👍 can no longer falsely flip them to Replied.

### 4. Burst-safe emission (Task 4)
Walks **all** items in each thread (not just `items[0]`), dispatching one event per inbound real message, oldest→newest. Two quick replies = two events in natural order. T2 dedups by `itemId`, so re-emitting already-seen items is harmless.

### 5. Fail-safe against IG shape changes (Task 5)
Entire parse wrapped in `try/catch` with optional chaining on every field. A field rename means detection silently does nothing — it can never throw in the page world and break Instagram for a rep.

## Event payload (Contract R1)

```js
document.dispatchEvent(new CustomEvent("ig_reply", {
  detail: { threadId, username /* lowercase, no @ */, itemId, text, itemType },
  bubbles: true, composed: true,
}));
```

`text` = message text, or `"[media]"` / `"[voice]"` / `"[link]"` placeholder for non-text types.

## Testing

13/13 checks pass via a Node harness (stubbed `window`/`document`/XHR, fake IG payloads driven through both interception paths):

| Check | Result |
|---|---|
| Inbound text → exactly 1 event, correct username/itemId/text | ✅ |
| Own outbound message → 0 events | ✅ |
| Missing viewer id → 0 events | ✅ |
| Reaction / seen / action_log → 0 events | ✅ |
| Two-message burst → 2 events, oldest-first | ✅ |
| Thread-endpoint shape (`data.thread` + `thread.viewer_id`) | ✅ |
| Broadcast send URL + non-DM URLs → 0 events | ✅ |
| Malformed payloads → no throw, 0 events | ✅ |
| XHR GET inbox read → 1 event; XHR POST (seen) → 0 events | ✅ |

`node --check page-interceptor.js` passes.

---

## ⚠️ Outstanding: verification step 0 (needs a human with a logged-in IG session)

Not done — no live Instagram session was available to this terminal. The code is fail-safe either way, but before rollout a rep should spend ~2 minutes in devtools (Network tab on instagram.com) confirming:

1. **Field paths for the current IG build**: `viewer.pk` / `thread.viewer_id`, `thread.users[].pk/.username`, `items[].user_id/.item_id/.item_type/.text`. If IG renamed any, detection is silently dead until paths are updated.
2. **The passive-detection question**: sit on the *feed* (not `/direct/`) and have someone reply. If background requests only return badge counts (likely), detection fires **only when a rep opens the inbox or a thread** — the feature promise should say "detects when a rep views the inbox/a thread," not "from any open tab." Reps live in the inbox, so most of the value survives either way.

## Wave status (all three terminals)

- **T1 (page-interceptor.js)** ✅ — this document.
- **T2 (instagram.js)** ✅ — `ig_reply` listener, persisted `fb_seenReplies` dedup, lead-handle prefilter, relays as `CROSS_PLATFORM_REPLY`.
- **T3 (background.js + server)** ✅ — forwards `item_id`/`thread_id`, broadcasts `LEAD_UPDATED` on every matched inbound, 📸 notif icon; server dedups on `(lead_id, channel, item_id)`.
- **Remaining before rollout**: run migration `013_messages_item_id_idempotency.sql` manually in the Supabase SQL editor (until then cross-rep dedup falls back to plain insert), devtools verification above, then T3's integration steps (manifest bump 2.0.0→2.1.0, live-IG checklist, commit+push).
