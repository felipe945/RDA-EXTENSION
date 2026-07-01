# FIX-TRUST · Terminal 2 — The truth layer (detect real sends, real account, real replies)

**Goal:** Give the content script (T1) two trustworthy signals — *"a DM actually sent"* and *"which account is really active"* — then fix the sidepanel + booking paths that record the wrong thing. Together with T1 this makes every "sent / booked / replied" state mean it actually happened.

**You own the truth layer + app fixes.** Your teammate (T1) owns `instagram.js` only and consumes the two contracts below. Do **not** edit `instagram.js`.

Working dirs: `/Users/felipe/unified-sales-ops/chrome-extension/ig-lead-tracker` and the Next.js app at `/Users/felipe/unified-sales-ops`.

---

## Why (root cause)

- `page-interceptor.js:39-42, 97-99` fire `ig_dm_sent` on **any** call to `/direct_v2/threads/` or `/api/v1/direct/` — including opening a thread, not just sending. T1 needs this to mean *a real send*.
- `background.js:272` writes `activeIgAccount` with **no timestamp**, so T1 can't tell a fresh value from a stale one → DMs go from the wrong account.
- `background.js:298-351` — the cross-platform reply matcher accepts `firstName.length≥4 && name.includes(firstName)`, so an unread from any "Chris" flips the first lead named Chris to **Replied** and fires a notification for a reply that never happened.
- `sidepanel.js:897` hardcodes the `ig_fanbasis` channel on "✓ DM Sent" regardless of which account was used, and the button ignores its own "mark channels first" hint (`:768`).
- `components/BookCallModal.tsx:92` PATCHes `follow_up_date` — a column that doesn't exist; the field is `due_at` (`lib/types.ts`), so the booked call time is silently dropped.

---

## 🤝 Shared contracts (IDENTICAL in T1 and T2 docs — do not diverge)

You **produce** these; T1 consumes them.

**Contract A — `ig_dm_sent` means a real outbound send.**
`page-interceptor.js` must dispatch `CustomEvent("ig_dm_sent")` **only when an outbound DM is actually sent** (an outbound POST to IG's send endpoint), not on thread open/read.

**Contract B — `activeIgAccount` freshness.**
Store the active account as:
```js
{ activeIgAccount: "<handle>", activeIgAccountTs: <epochMs> }
```
Stamp `activeIgAccountTs` on **every** write of `activeIgAccount`. (T1 treats it as unknown if older than 5 min.)

> Land Contracts A + B **first**, then ping T1 **"truth layer landed."** ← the one handshake.

---

## File ownership (T2 = you)

| File | Action |
|------|--------|
| `page-interceptor.js` | Contract A — fire `ig_dm_sent` only on a real send |
| `background.js` | Contract B (stamp ts) + Ext#6 (tighten reply matcher) |
| `sidepanel.js` | Ext#7 — record the real channel, honor the chips |
| `components/BookCallModal.tsx` | Dash#1 — `follow_up_date` → `due_at` |
| `lib/leads-update.ts` | verify `due_at` passes through the PATCH |

T1 owns `instagram.js` only. No overlap.

---

## Tasks

### ⚡ Phase 0 — land the two contracts first, then ping T1

**Task 1 (Contract A) — `page-interceptor.js:39-42, 97-99`.** Gate the `ig_dm_sent` dispatch on an actual outbound send: require the request **method is POST** (fetch: check the `init?.method`/`Request.method`; XHR: you already capture `this._method` — if not, record it in the `open` override) **and** the URL is a send endpoint (e.g. contains `/direct_v2/threads/broadcast/` or the send path — verify the real path in devtools Network while sending a DM). A GET/thread-fetch must **not** dispatch. Keep it resilient: if unsure, dispatch on POST-to-`/direct_v2/threads/` only.

**Task 2 (Contract B) — `background.js:272` (and any other `activeIgAccount` writer, e.g. the `FB_PROFILE_ACTIVE`/viewer path near `:229-272`).** Every time you `set({ activeIgAccount })`, also set `activeIgAccountTs: Date.now()`. Grep to be sure you got them all:
```
grep -n "activeIgAccount" background.js page-interceptor.js
```
(If page-interceptor writes it via a dispatched viewer event that background persists, stamp it where background persists it.)

**→ Commit/save, ping T1: "truth layer landed."**

### Phase 1 — the remaining truth fixes (parallel with T1)

**Task 3 (Ext#6) — tighten the reply matcher, `background.js:298-351`.** Drop the loose `firstName.length≥4 && nameLower.includes(firstName)` branch. Match only on: exact handle equality, LinkedIn-URL match, or **full-name** equality (normalized). If more than one lead matches, or the match is name-only and ambiguous, **do not auto-advance to Replied and do not fire a notification** — surface it as an "unmatched reply" at most. Never flip a lead to Replied on a first-name substring.

**Task 4 (Ext#7) — sidepanel "✓ DM Sent" records the real channel, `sidepanel.js:890-911` (+ hint at `:768`).** Stop hardcoding `ig_fanbasis`. Derive the channel from the touch chips the rep actually toggled: `fbDone → ig_fanbasis`, `persDone → ig_personal`, both → mark both; if neither is set, record a neutral `ig`. Don't wipe chip state that represents a real touch. (The chips already exist in the card state — `getChannelDone(lead.id)`.)

**Task 5 (Dash#1) — booking writes the real column.**
- `components/BookCallModal.tsx:92`: change `follow_up_date` → `due_at`.
- `lib/leads-update.ts`: confirm `applyLeadPatch` passes `due_at` straight through (it spreads fields; just verify no allow-list drops it) and that the modal still sets `stage: "Booked"`. After the fix a booked lead has a real `due_at`, so it shows up in follow-up/briefing surfaces.

---

## Handshake
Phase 0 (Contracts A + B) lands first → ping T1. Phases 1 tasks run in parallel with T1's work. You never touch `instagram.js`; T1 never touches your files.

## Test checklist
- [ ] Sending a real IG DM fires `ig_dm_sent`; merely **opening** a thread does **not** (coordinate with T1's gate test).
- [ ] `activeIgAccount` write always sets `activeIgAccountTs` (grep-verify no writer missed).
- [ ] A LinkedIn/Twitter unread from "Chris" does **not** flip an unrelated lead named Chris to Replied.
- [ ] Sidepanel "DM Sent" after marking only the Personal chip records `ig_personal`, not `ig_fanbasis`.
- [ ] Book a Call → the lead has a populated `due_at` (check the row) and appears in the follow-up view.
- [ ] `node --check page-interceptor.js background.js sidepanel.js` passes; app typechecks.

## Done when
`ig_dm_sent` means a real send; `activeIgAccount` carries a timestamp; the reply matcher can't hit the wrong lead; the sidepanel logs the channel actually used; booked calls persist their time. Hand back with the checklist ticked.
