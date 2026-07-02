# FIX-REPLIES · T2 SUMMARY — DEDUP + RELAY (instagram.js) ✅ DONE

**Owned file:** `chrome-extension/ig-lead-tracker/instagram.js` (only file touched, plus one line in its existing `LEAD_UPDATED` listener). Did not touch `page-interceptor.js` (T1) or `background.js` (T3).

**Status:** All 4 tasks complete. Full test checklist passing (12/12 in a Node harness running the actual code block from the file with mocked `chrome` APIs). `node --check` passes. **Not yet committed.**

---

## What was built

All new code lives in one section at `instagram.js` ~`:66-130`, directly beside the `ig_viewer` relay it mirrors, plus one line added to the existing `chrome.runtime.onMessage` listener (~`:2551`).

### Task 1 — `ig_reply` listener (Contract R1 in)
- Listens for the `ig_reply` CustomEvent from T1's page-interceptor.
- Drops malformed events (missing `username`, `itemId`, or `threadId`) silently — no throw.
- Events are **serialized through a promise chain** so a fast burst of events can't interleave the storage read-check-write and double-relay the same item.

### Task 2 — persisted dedup (survives SW restarts)
- `chrome.storage.local` key: `fb_seenReplies: { [threadId]: { itemId, ts } }` — includes the timestamp the original plan's shape was missing, so pruning is possible.
- Same `{threadId, itemId}` seen again → skip. New `itemId` on the same thread → relays (follow-ups get through).
- Deliberately does NOT rely on background's in-memory `seenNotifIds`.
- Per-browser only, as specced — cross-rep dedup is T3's job via the forwarded `itemId`.

### Task 3 — relay (Contract R2 out) + lead-handle prefilter
Sends exactly per Contract R2, including the two new idempotency fields:

```js
chrome.runtime.sendMessage({
  type: "CROSS_PLATFORM_REPLY",
  platform: "ig",
  detectedName: username,   // lowercase handle, exact-match target
  messagePreview: text,
  itemId,                   // NEW — T3 server-side idempotency
  threadId,                 // NEW — T3 server-side idempotency
}).catch(() => {});
```

Optional prefilter implemented: a cached lowercased set of tracked `ig_username`s from `GET_LEADS`, refreshed **on `LEAD_UPDATED`** and **every 5 minutes**. Untracked inbounds are skipped to cut noise. Two safety choices:
- **Empty or not-yet-loaded set → relay-all fallback** (a failed/slow GET_LEADS can never suppress real replies; T3's matcher drops non-leads anyway).
- **Filtered items are NOT marked seen** — a reply that lands just before its lead is added isn't permanently suppressed; it relays once the lead exists.

### Task 4 — prune
Entries with `ts` older than 30 days are dropped on every map write.

---

## Test checklist results (Node harness, real extracted code, mocked chrome APIs)

| Check | Result |
|---|---|
| Dispatch `ig_reply` → exactly one `CROSS_PLATFORM_REPLY` with `itemId`+`threadId` | ✅ |
| Same `{threadId,itemId}` again → no second relay | ✅ |
| Simulated extension reload (storage persists, memory reset) → still no relay | ✅ |
| New `itemId`, same `threadId` → relays | ✅ |
| Malformed detail (missing itemId) / undefined detail → dropped, no throw | ✅ |
| Untracked handle filtered AND not marked seen; relays after lead added | ✅ |
| Empty lead set → relay-all fallback | ✅ |
| Stale (>30d) entry pruned on write | ✅ |
| `node --check instagram.js` | ✅ |

Real-browser smoke test (anyone can run in the IG tab console, no T1 needed):

```js
document.dispatchEvent(new CustomEvent("ig_reply", {
  detail: { threadId: "t1", username: "somehandle", itemId: "i1", text: "hey" }
}));
```

---

## Notes for integration (T3 drives)

- T2 is code-complete but **uncommitted** — T3's integration step waits on the T2 commit.
- New storage key claimed: `fb_seenReplies` (chrome.storage.local). No other shared state touched.
- The `LEAD_UPDATED` broadcast T3 now sends on every matched inbound also refreshes T2's prefilter set for free (same listener line).
