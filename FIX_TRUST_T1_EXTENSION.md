# FIX-TRUST · Terminal 1 — Commit only on confirmed truth (IG content script)

**Goal:** Stop the pipeline from recording work that never happened, and stop DMs going from the wrong account. This is the **trust foundation** — until a "sent / offered / booked" state means it actually happened, nothing else in the tool can be believed.

**You own `instagram.js` only.** Your teammate (T2) owns the "truth layer" that feeds you two signals (a real send-confirmation event and a fresh active-account value) and fixes the sidepanel + booking-column bugs. Do **not** edit `page-interceptor.js`, `background.js`, `sidepanel.js`, or any `app/`/`lib/` file.

Working dir: `/Users/felipe/unified-sales-ops/chrome-extension/ig-lead-tracker`

---

## Why (root cause)

Four findings, one theme: **the content script commits state on a button click or a stale guess, not on confirmed reality.**

- `instagram.js:1337-1362` — clicking "📨 Send" fires `markChannelSent` + `FB_DM_SENT` (→ stage **DM Sent**, +3-day follow-up) *immediately*. The genuine `ig_dm_sent` event (from `page-interceptor.js`) only *also* advances (`instagram.js:1380`) — it is never required. So a DM that never sent still marks the lead contacted.
- `instagram.js:1473-1477` — if the active account can't be identified, the channel silently defaults to `ig_fanbasis` and no switch is forced → DM goes from whatever handle is logged in, tagged as FanBasis.
- `instagram.js:660-666` — the switch step reads `activeIgAccount`, a global with no freshness check, so a stale value skips the switch and sends from the wrong account.
- `instagram.js:1543-1564` — the two-touch bridge DM ("I also messaged you from @fanbasis…") is composed purely because the first Send was clicked, even if that first DM never went out.

---

## 🤝 Shared contracts (IDENTICAL in T1 and T2 docs — do not diverge)

T2 guarantees these; you consume them.

**Contract A — `ig_dm_sent` means a real outbound send.**
`page-interceptor.js` dispatches `document`-level `CustomEvent("ig_dm_sent")` **only when an outbound DM is actually sent** (a POST to IG's send endpoint), not when a thread is merely opened. You may treat its arrival as ground truth that the message left.

**Contract B — `activeIgAccount` freshness.**
The active IG account is stored in `chrome.storage.local` as:
```js
{ activeIgAccount: "<handle>", activeIgAccountTs: <epochMs> }
```
T2 stamps `activeIgAccountTs` on every write. You must treat the account as **known only if** `Date.now() - activeIgAccountTs <= ACCOUNT_MAX_AGE_MS` (use `5 * 60 * 1000`). Older than that → treat account as **unknown** (do not assume FanBasis).

> **Dependency:** you can write all the code now, but runtime-testing Ext#1 needs T2's page-interceptor tightening (A) and Ext#2/#3 need T2's timestamp write (B). T2 will ping **"truth layer landed."**

---

## File ownership (T1 = you)

| File | Action |
|------|--------|
| `instagram.js` | all edits below — send-gating, account-trust, two-touch, booking afterSend |

Nothing else.

---

## Tasks

### Task 1 (Ext#1) — Commit a DM only on confirmed send

Restructure the `confirmBtn` "📨 Send" handler at **`instagram.js:1336-1381`**. Split "help the rep send" from "record that it sent":

- **On click:** copy text, `openIgDm(username)`, `autoTypeInIgDm`, `autoConfirmIgDialog()` — as today. Then enter a **pending** state: button → `"⏳ Waiting for send…"`, disabled. Do **NOT** call `markChannelSent`, `markPillSent`, `FB_DM_SENT`, or `advance()` here.
- **Commit path (real):** when `ig_dm_sent` fires (Contract A), run the commit: `markChannelSent` → `markPillSent` → `FB_DM_SENT` → `advance()` (which runs `opts.afterSend`).
- **Commit path (fallback, human-attested):** if `ig_dm_sent` hasn't fired within `SEND_CONFIRM_TIMEOUT_MS` (use `8000`), swap the pending button for an explicit **"✓ I sent it"** button. Only its click runs the same commit. This keeps the invariant: *state advances only when the network confirms OR a human explicitly attests* — never on the mere act of clicking Send.
- Factor the commit into one `commitSent()` closure so both paths are identical and it can only run once (guard with the existing `sent` flag — but set `sent=true` inside `commitSent`, not on click).
- Add a listener cleanup + a `clearTimeout` so a `Back`/re-render can't leak a stale `ig_dm_sent` listener onto the next lead.

> Caveat to verify at runtime: confirm `ig_dm_sent` does not fire on thread-open after T2's tightening. If it still does, the 8s fallback covers correctness; flag it back to T2.

### Task 2 (Ext#5) — Booking / script paths inherit the gate for free

`instagram.js:1042-1062` and `:2099-2114` set stage **Call Offered** via `opts.afterSend`. Because Task 1 only calls `advance()` (and thus `afterSend`) inside `commitSent()`, these now advance only on confirmed send. **Verify** both call sites route through `showDmPreview({... afterSend})` and don't separately fire an early stage update; if any does, remove the early update.

### Task 3 (Ext#2 + Ext#3) — Never send from an unconfirmed / wrong account

- **`instagram.js:1473-1477`:** remove the silent `"ig_fanbasis"` default. Compute the account via `detectCurrentIgAccountFromDom()` **and** the fresh `activeIgAccount` (Contract B). If neither confirms a known handle, do **not** pick a channel — render a small inline notice ("Confirm which account you're on") and require the rep to pick FB / Personal before the Send button enables.
- **`instagram.js:660-666` (`renderSwitchPrompt`):** before deciding "already on target and skip the switch," require `activeIgAccount` to be **fresh** (Contract B). If stale/unknown, show the switch prompt rather than trusting the old value. The "Skip — send as current account" path must label the actual detected handle, not assume the target.

### Task 4 (Ext#4) — The bridge DM is only true if touch #1 was sent

`instagram.js:1543-1564` (`handleAfterFirstSend` / `completeBothSends`): only compose the "I also messaged you from @…" bridge and advance to touch #2 **after touch #1's `commitSent` ran** (Task 1). Thread a `firstTouchConfirmed` flag out of `commitSent` into `handleAfterFirstSend`; if the first send was never confirmed, do not send a bridge message that references it — fall back to a standalone opener for the second account.

---

## Handshake
Code freely now. Before runtime-testing, wait for T2's **"truth layer landed"** (Contracts A + B live). You touch only `instagram.js`; T2 touches everything else.

## Test checklist (load unpacked, on instagram.com)
- [ ] Click Send but **don't** actually send in IG (close the compose) → after 8s you get "✓ I sent it"; lead is **NOT** marked DM Sent until you tap it.
- [ ] Send a real DM → `ig_dm_sent` fires → lead auto-advances to DM Sent with the follow-up, no manual tap needed.
- [ ] On personal IG with detection stale/unknown → Send is blocked until you pick an account; the DM never silently goes as FanBasis.
- [ ] Two-touch: abort touch #1 (don't send) → no bridge message referencing it on touch #2.
- [ ] Book-a-Call insert → lead reaches **Call Offered** only after the DM is confirmed sent.

## Done when
State advances only on confirmed send (network or explicit human tap); no DM sends from an unconfirmed account; the bridge never references an unsent message. `node --check instagram.js` passes. Hand back with the checklist ticked.
