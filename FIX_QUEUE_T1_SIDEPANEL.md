# FIX-QUEUE · Terminal 1 — Shared Queue + Sidepanel

**Goal:** Fix the inaccurate "% reached out" bar and the Next-button / sidepanel inconsistency by collapsing the extension's **three** competing outreach queues into **one shared module**, then wiring the sidepanel to it.

**Your teammate (T2)** rewires the floating IG card (`instagram.js`) to the same module. **You own the shared file + manifest + the sidepanel.** Do not touch `instagram.js`.

Working dir: `/Users/felipe/unified-sales-ops/chrome-extension/ig-lead-tracker`

---

## Why (root cause — read once)

- The sidepanel progress bar (`sidepanel.js:781-786`) measures **cursor position among un-contacted leads**, not "% of the batch reached out." The denominator shrinks as you DM people, so it can read 0% when you're actually 40% done. Label `(idx+1)/len` and bar `idx/(len-1)` also disagree (off-by-one; a 1-lead queue shows "1/1" with an empty bar).
- Three queues exist with **different done-stage lists, snooze rules, and no shared count**: sidepanel `buildOutreachQueue` (`sidepanel.js:475-487`) vs floating-card pickers (`instagram.js:1528, 1668, 1883, 2236`). They disagree on `Active/Churned/Blocked` and on snooze, so "Next →" and "X / N" differ between surfaces.
- All queues sort by top-level `lead.score` but display `research_cache.fitScore` — order looks arbitrary for un-researched leads.

Fix = one source of truth for filter + sort + batch math, consumed by both surfaces.

---

## 🤝 Shared contract (IDENTICAL in T1 and T2 docs — do not diverge)

New file `outreach-queue.js` exposes `window.FBQueue`. It loads **before** `sidepanel.js` (sidepanel.html) and **before** `instagram.js` (manifest content_scripts) — same mechanism `scripts-data.js` already uses.

```js
// outreach-queue.js — SINGLE source of truth for outreach queue filtering, sorting,
// and batch-progress math. Loaded in BOTH the sidepanel and the IG content script.
// Do NOT fork this logic back into sidepanel.js / instagram.js.
(function () {
  const DONE_STAGES = ["DM Sent", "Replied", "Qualifying", "Call Offered", "Booked", "Closed", "DQ", "Active", "Churned", "Blocked"];

  // "Reached out" line: leads at/after these stages have been contacted on this channel.
  const CONTACTED_STAGES = ["DM Sent", "Replied", "Qualifying", "Call Offered", "Booked", "Active"];

  // Dead stages excluded from the addressable batch entirely.
  const DEAD_STAGES = ["DQ", "Closed", "Churned", "Blocked"];

  // Sort/display parity: sort by the SAME number the card shows (fitScore), fall back to heuristic score.
  function sortScore(lead) {
    const cache = lead.research_cache || {};
    return typeof cache.fitScore === "number" ? cache.fitScore : (lead.score ?? 0);
  }

  function hasChannel(lead, channel) {
    if (channel === "ig") return !!(lead.ig_username || lead.ig_profile_url);
    if (channel === "linkedin") return !!lead.linkedin_url;
    return true;
  }

  function isSnoozed(lead, snoozed, now) {
    const until = snoozed && snoozed[lead.id];
    return !!until && until > (now == null ? Date.now() : now);
  }

  // Canonical OPEN queue: not-done, not-snoozed, has the channel, sorted by displayed score desc.
  function buildQueue(leads, opts) {
    opts = opts || {};
    const channel = opts.channel || "ig";
    const snoozed = opts.snoozed || {};
    const now = opts.now == null ? Date.now() : opts.now;
    return (leads || [])
      .filter((l) => !DONE_STAGES.includes(l.stage))
      .filter((l) => !isSnoozed(l, snoozed, now))
      .filter((l) => hasChannel(l, channel))
      .sort((a, b) => sortScore(b) - sortScore(a));
  }

  // Batch progress = reached-out share of the addressable batch (contacted + still-open),
  // NOT cursor position. This is the number the % bar must use.
  function computeBatchProgress(leads, opts) {
    opts = opts || {};
    const channel = opts.channel || "ig";
    const addressable = (leads || []).filter((l) => hasChannel(l, channel) && !DEAD_STAGES.includes(l.stage));
    const total = addressable.length;
    const contacted = addressable.filter((l) => CONTACTED_STAGES.includes(l.stage)).length;
    const pct = total ? Math.round((contacted / total) * 100) : 0;
    return { contacted, total, pct };
  }

  window.FBQueue = { DONE_STAGES, CONTACTED_STAGES, DEAD_STAGES, sortScore, hasChannel, buildQueue, computeBatchProgress };
})();
```

> **DECISION baked in:** "the batch" = all leads on this channel that aren't dead (DQ/Closed/Churned/Blocked). "Reached out" = stage ≥ DM Sent. If Felipe wants a batch to mean a *specific import*, we'd need to group by an import id — flag it, don't block on it.

---

## File ownership (T1 = you)

| File | Action |
|------|--------|
| `outreach-queue.js` | **CREATE** (paste the contract above verbatim) |
| `manifest.json` | register shared file in IG `content_scripts` |
| `sidepanel.html` | load shared file before `sidepanel.js` |
| `sidepanel.js` | delegate queue → `FBQueue`; rebuild the % bar; fix Next/Prev |
| `styles.css` | tweak `.queue-progress` markup if needed |

T2 owns `instagram.js` only. **No shared file edits between you.**

---

## Tasks

### ⚡ Phase 0 — land the shared file FIRST, then ping T2 (unblocks T2 runtime testing)

1. **Create `outreach-queue.js`** with the contract source above, verbatim.
2. **`manifest.json`** — add it before `instagram.js` in the Instagram content-script entry:
   ```json
   { "matches": ["https://www.instagram.com/*"],
     "js": ["scripts-data.js", "outreach-queue.js", "instagram.js"],
     "run_at": "document_idle" }
   ```
3. **`sidepanel.html`** (~line 173) — load it before `sidepanel.js`:
   ```html
   <script src="scripts-data.js"></script>
   <script src="outreach-queue.js"></script>
   <script src="sidepanel.js"></script>
   ```
4. **Commit/save + tell T2: "shared file + manifest landed."** ← the one handshake.

### Phase 1 — sidepanel consumes the shared queue

5. `sidepanel.js:475-487` — replace the body of `buildOutreachQueue(channel)` with a thin delegate (keep the name; callers stay unchanged):
   ```js
   function buildOutreachQueue(channel) {
     return window.FBQueue.buildQueue(allLeads, { channel, snoozed: snoozedLeads });
   }
   ```
   Delete the local `DONE`/sort logic — it now lives in the module.

### Phase 2 — fix the % bar (your headline bug)

6. `sidepanel.js:780-786` — replace the `queue-progress` block. Split the two concepts that were conflated: **batch progress** (the % bar) vs **cursor** (which card you're on).
   ```js
   const prog = window.FBQueue.computeBatchProgress(allLeads, { channel: outreachChannel });
   // ...inside list.innerHTML:
   <div class="queue-progress">
     <span class="queue-pos">Reached out: ${prog.contacted} / ${prog.total} (${prog.pct}%)</span>
     <div class="queue-bar-bg">
       <div class="queue-bar-fill" style="width:${prog.pct}%"></div>
     </div>
   </div>
   <div class="queue-cursor">Card ${outreachIdx + 1} of ${queue.length} to do</div>
   ```
   - Bar width is now `prog.pct` (true batch %), not `idx/(len-1)`. Off-by-one and the 1-lead "0%" case are both gone.
   - Add a `.queue-cursor` style in `styles.css` (small, muted — mirror `.queue-pos`, `styles.css:183`).

### Phase 3 — Next/Prev can't diverge from the IG tab

7. `sidepanel.js:970-977` — today "Next →" only moves `outreachIdx`; it never navigates the IG tab, so a focus/storage/`FB_PROFILE_ACTIVE` refresh snaps the card back to the still-open profile. Make Next/Prev **also drive the IG tab** so the auto-sync (`sidepanel.js:417-443, 1159-1170`) re-affirms instead of fights:
   ```js
   document.getElementById("nextBtn")?.addEventListener("click", () => {
     outreachIdx = Math.min(queue.length - 1, outreachIdx + 1);
     const next = queue[outreachIdx];
     const url = next && igUrl(next);
     if (url && outreachChannel === "ig") openInIgTab(url);
     renderOutreach();
   });
   ```
   Mirror for `prevBtn`. (Only navigate on the `ig` channel; leave LinkedIn as a pure preview.)

---

## Test checklist (load unpacked, DM flow)

- [ ] % bar shows **contacted/total (pct%)** and matches reality: DM 3 of 10 → ~30%, and rises as you mark DM Sent (does NOT reset to 0 on card 1).
- [ ] 1-lead queue: bar reflects real batch %, not an empty "1/1" bar.
- [ ] Sidepanel "X to do" count == floating card "X / N" (verify with T2 after their pass).
- [ ] Click "Next →" in sidepanel → IG tab navigates to that profile and the card **stays** there after window refocus (no snap-back).
- [ ] Queue order matches the fit-score badges shown on cards.

## Done when
Shared file + manifest + sidepanel.html landed; sidepanel queue delegates to `FBQueue`; % bar is a true batch meter; Next/Prev keep card and IG tab in sync. Hand back to Felipe with the test checklist ticked.
