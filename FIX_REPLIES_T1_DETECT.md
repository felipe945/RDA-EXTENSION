# FIX-REPLIES · Terminal 1 — DETECT (page-interceptor.js)

**You own ONE file: `page-interceptor.js`.** Do not touch `instagram.js` or `background.js` — T2 and T3 own those and run in parallel. You talk to them only through the frozen contract below.

Working dir: `/Users/felipe/unified-sales-ops/chrome-extension/ig-lead-tracker`

---

## Shared contracts (FROZEN — all 3 terminals depend on these; do not change without pinging the other two)

**Contract R1 — `ig_reply` CustomEvent (T1 → T2).** You emit this; T2 consumes it.
```js
document.dispatchEvent(new CustomEvent("ig_reply", {
  detail: {
    threadId,   // string, IG thread id
    username,   // string, the OTHER participant's exact @handle (no leading @, lowercase)
    itemId,     // string, IG item_id of THIS message — the dedup/idempotency key
    text,       // string, message text, or "[media]" / "[reaction]" placeholder
    itemType,   // string, IG item_type ("text","media","clip",... ) — for T2/debug
  },
  bubbles: true, composed: true,
}));
```
Emit **one event per new inbound message item** (see Task 4 — walk items, not just `items[0]`). Stateless: page world has no `chrome.*`; you never dedup or store — that's T2.

**Contract R2 — `CROSS_PLATFORM_REPLY`** is T2→T3's problem, not yours. Ignore it.

---

## Context: what the interceptor already does

- Overrides `window.fetch` (`:17`) and `XHR.open/send` (`:75/:81`) in the page MAIN world.
- Reads response bodies **only for viewer detection**, and only for URL-gated cases:
  - fetch path (`:52-69`): parses JSON **only** when `url.includes("graphql") || url.includes("api/v1")`, and **`return`s early after finding a viewer** (`:64`).
  - XHR path (`:82-99`): reads `responseText` **only** for `current_user | graphql | api/v1/feed`. **`/direct_v2/` is NOT in this allowlist.**
- Already has `isDmSendUrl()` (`:13`) = broadcast endpoint = outbound send (Contract A). Do not confuse DM *send* with DM *read*.

> The original plan said "reuse the same response-body reading." That undersells it: the readers are **URL-allowlisted and the fetch path early-returns**. You must add DM reads as their own branch, or they'll be silently skipped.

---

## Tasks

### Task 1 — parse DM reads in BOTH paths
Add a `handleDmResponse(url, data)` helper and call it from both interceptors:
- **fetch path:** after `origFetch` resolves, if `url` matches an inbox/thread read (below), clone + `.json()` and call `handleDmResponse`. Put this **independent of** the viewer block so the `return` at `:64` can't skip it (either move DM parsing above the viewer `return`, or restructure so both run).
- **XHR path:** add the inbox/thread URL patterns to the `load` handler and `JSON.parse(this.responseText)` for them. `/direct_v2/` is currently excluded — you must add it.

URL match (GET reads, NOT the send endpoint):
```js
const isDmRead = /\/direct_v2\/inbox\//.test(url) || /\/direct_v2\/threads\/\d+\//.test(url);
```
Never treat `/direct_v2/threads/broadcast/` as a read (that's Contract A send).

### Task 2 — require a KNOWN viewer id before classifying (guards a shared-account landmine)
Determine the viewer id from the response (`data.viewer_id`, `data.inbox?.viewer`, or the logged-in user id — **verify in devtools**).
```js
if (viewerId == null) return;   // MANDATORY: never classify without it
```
Rationale: inbound is decided by `item.user_id !== viewerId`. If `viewerId` is `undefined`, that comparison is **always true**, so on the shared FanBasis account **the reps' own outbound DMs get flagged as inbound replies** → false "Replied" flips + notification floods. No known viewer → emit nothing.

### Task 3 — classify ONLY real inbound messages (no reactions / seen / likes)
For each thread, for each candidate item:
- inbound = `item.user_id !== viewerId`
- **and** `item.item_type` is a real message type. Allowlist, don't blocklist:
  ```js
  const REAL = new Set(["text", "media", "clip", "voice_media", "raven_media", "animated_media", "link", "share", "story_share"]);
  if (!REAL.has(item.item_type)) continue;   // drop reaction / like / action_log / seen markers
  ```
  Reason: a prospect's 👍 reaction or a "seen" marker lands in `items[]` with their `user_id`. Without this, a reaction falsely flips them to Replied with body `"[media]"`.
- Extract:
  - `username` = the non-viewer user from `thread.users[]` → their `.username`, lowercased, `@` stripped.
  - `text` = `item.text` for text; else a type placeholder (`"[media]"`, `"[reaction]"` won't occur since filtered, `"[voice]"`, etc. — a simple `"[media]"` fallback is fine).
  - `itemId` = `item.item_id`, `threadId` = thread id.

### Task 4 — emit every NEW item, newest-last (don't lose burst replies)
Items come newest-first. Don't hard-code `items[0]`. Walk items and dispatch an `ig_reply` for **each** inbound real-message item in the response. T2 dedups by `itemId`, so emitting a few already-seen ones is harmless — but only reading `items[0]` means two quick replies lose one from the log. Dispatch oldest→newest so ordering is natural downstream.

### Task 5 — bulletproof against IG shape changes
Wrap the whole DM parse in `try/catch` and guard every field with `?.`. A field rename must never throw in the page (it would break IG for the rep). On any parse failure: emit nothing, don't log-spam.

---

## ⚠️ Verification step 0 — DO THIS FIRST, it can resize the whole feature
Before writing code, open devtools → Network on instagram.com and answer:
1. **Sit on the FEED (not `/direct/`).** Have someone reply. Does any background request return a body containing `threads[].items[]`, or only a **badge count** (`get_badge_count`, a presence GraphQL count)?
   - If only a count comes back in the background, then passive "detects off any open tab" is **false** — detection only fires when a rep opens the inbox/a thread. Report this to Felipe and adjust the promise to "detects on inbox/thread view." (Reps live in the inbox, so still most of the value — but don't oversell.)
2. Confirm the exact field paths for this build: `viewer_id`, `thread.users[].username`, `thread.items[].user_id`, `.item_id`, `.item_type`, `.text`. IG renames these periodically.

Write your findings at the top of your commit message so T2/T3 know reality.

---

## Test checklist (T1 in isolation — console-log the events)
- [ ] Open a lead's DM thread where they replied → exactly one `ig_reply` fires with the right `username`/`itemId`/`text`.
- [ ] Your OWN just-sent message in that thread → **no** `ig_reply` (user_id === viewerId).
- [ ] A response where viewer id is absent → **no** `ig_reply` (Task 2 guard).
- [ ] A prospect 👍 reaction / a "seen" marker → **no** `ig_reply` (Task 3 filter).
- [ ] Two quick inbound messages → **two** events, oldest-first (Task 4).
- [ ] `node --check page-interceptor.js` passes.

## Done when
Real inbound IG messages (and only those) emit `ig_reply` per Contract R1, with a known viewer id, correct across the fetch and XHR paths, never throwing on shape changes. Verification-step-0 findings reported.
