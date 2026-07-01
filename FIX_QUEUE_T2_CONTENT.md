# FIX-QUEUE · Terminal 2 — Floating IG Card (content script)

**Goal:** Make the floating IG card's **"Next →" / "Skip"** navigation and its **"X / N"** counter use the **same shared queue** as the sidepanel, so the two surfaces never disagree on order, count, done-stages, or snooze.

**Your teammate (T1)** creates the shared module (`outreach-queue.js`), registers it in the manifest, and rewires the sidepanel. **You own `instagram.js` only.** Do not touch `sidepanel.js`, `manifest.json`, `sidepanel.html`, or `outreach-queue.js`.

Working dir: `/Users/felipe/unified-sales-ops/chrome-extension/ig-lead-tracker`

---

## Why (root cause — read once)

The floating card has **four** hand-rolled "next lead" pickers, each with its own copy of the done-stage list and none of them honoring snooze the way the sidepanel does:

| Location | What it does | Bug |
|----------|--------------|-----|
| `instagram.js:1528-1540` (`completeBothSends`) | "Next →" after both touches | local `DONE_STAGES` (7 stages), no snooze filter |
| `instagram.js:1668-1728` (nav strip) | Skip / Next + "X / N" counter | local `DONE_STAGES_NAV`, reads `fb_snoozed` for buttons but doesn't filter queue by it |
| `instagram.js:1883-1895` | "Next →" variant | local `DONE_STAGES`, no snooze |
| `instagram.js:2236-2248` | "Next →" variant | local `DONE_STAGES`, no snooze |

Result: the card treats `Active/Churned/Blocked` as still-open (sidepanel treats them done) and can send you to snoozed leads the sidepanel hides. The "X / N" total therefore differs from the sidepanel's. All four also sort by `l.score` while cards display `research_cache.fitScore`.

Fix = delete the local lists/sorts, call the shared module.

---

## 🤝 Shared contract (IDENTICAL in T1 and T2 docs — do not diverge)

T1 creates `outreach-queue.js`, which exposes `window.FBQueue`. Because the manifest loads it before `instagram.js` (same as `scripts-data.js`), you call it directly as a global. **API you consume:**

```js
// Canonical open queue: not-done, not-snoozed, has channel, sorted by displayed score desc.
window.FBQueue.buildQueue(leads, { channel: "ig", snoozed: fb_snoozed /* {id: untilMs} */ });

// (available if needed) reached-out share of the addressable batch:
window.FBQueue.computeBatchProgress(leads, { channel: "ig" }); // -> { contacted, total, pct }

// DONE_STAGES, CONTACTED_STAGES, sortScore(lead), hasChannel(lead, ch) also exported.
```

`DONE_STAGES` in the module = `["DM Sent","Replied","Qualifying","Call Offered","Booked","Closed","DQ","Active","Churned","Blocked"]`. Sort key = `fitScore ?? score`.

> **Dependency:** you can refactor against this API now, but runtime testing needs T1's Phase 0 landed (shared file + manifest). T1 will ping **"shared file + manifest landed."** Until then the global is `undefined` on the page.

---

## File ownership (T2 = you)

| File | Action |
|------|--------|
| `instagram.js` | replace all 4 local next-lead pickers + counter with `FBQueue` calls |

Nothing else. All shared-file / manifest / sidepanel work is T1's.

---

## Tasks

For **each** of the four pickers, the pattern is the same. Replace the local filter+sort with a shared-queue call, then pick the next lead relative to the current one. Each handler must have `fb_snoozed` available — read it if the surrounding scope doesn't already (`const { fb_snoozed = {} } = await chrome.storage.local.get({ fb_snoozed: {} });`). The nav strip at 1668 already reads it.

1. **`completeBothSends` — `instagram.js:1528-1540`.** Delete local `DONE_STAGES`. Replace the picker:
   ```js
   const { fb_snoozed = {} } = await chrome.storage.local.get({ fb_snoozed: {} }).catch(() => ({ fb_snoozed: {} }));
   chrome.runtime.sendMessage({ type: "GET_LEADS" }, (resp) => {
     const queue = window.FBQueue.buildQueue(resp?.leads || [], { channel: "ig", snoozed: fb_snoozed });
     const nextLead = queue.find((l) => l.id !== lead?.id);
     if (nextLead) { /* build nextBtn exactly as today, navigate to nextUrl */ }
   });
   ```
   (This handler isn't `async` today — either make its callback async to read `fb_snoozed`, or hoist the `fb_snoozed` read to just before the `GET_LEADS` call.)

2. **Nav strip — `instagram.js:1668-1728`.** Delete `DONE_STAGES_NAV`. Build the queue via the module so the **"X / N"** counter (`pos + 1 / queue.length`, line ~1687) matches the sidepanel exactly:
   ```js
   const queue = window.FBQueue.buildQueue(all, { channel: "ig", snoozed: fb_snoozed });
   const pos = queue.findIndex((l) => l.id === currentLeadId);
   const nextLead = queue.find((l) => l.id !== currentLeadId);
   ```
   Keep the Skip/Next/snooze button wiring as-is; only the source list changes. (`fb_snoozed` is already read here.)

3. **`instagram.js:1883-1895`** — same substitution as #1 (delete local `DONE_STAGES`, use `FBQueue.buildQueue` with snooze).

4. **`instagram.js:2236-2248`** — same substitution as #1.

5. **Grep-sweep to finish:** after the four edits, confirm nothing local remains:
   ```
   grep -n "DONE_STAGES\|DONE_STAGES_NAV\|(x.score ?? 0) - (a.score ?? 0)" instagram.js
   ```
   Every next-lead/sort site should now go through `window.FBQueue`. Leave unrelated `.score` reads (e.g. display) alone.

---

## Test checklist (load unpacked, on instagram.com)

- [ ] Snooze a lead in the sidepanel → floating card "Next →"/"Skip" **skips it** (previously navigated to it).
- [ ] A lead in `Active`/`Churned` is **not** offered as "Next →" (previously was).
- [ ] Floating card "X / N" total **equals** the sidepanel's "to do" count for the same channel (coordinate with T1).
- [ ] "Next →" lands on the highest-fit remaining lead (order matches the fit-score badges).
- [ ] All four buttons still navigate (`window.location.href`) correctly after the refactor.

## Done when
All four pickers + the counter route through `window.FBQueue`; no local `DONE_STAGES`/score-sort left in `instagram.js`; card and sidepanel agree on order, count, done-stages, and snooze. Hand back to Felipe with the checklist ticked.
