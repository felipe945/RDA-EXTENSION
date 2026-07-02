# HANDOFF · SPLIT-T2 (UI parity: dashboard + extension) — 2026-07-02

All 7 tasks in SPLIT_T2_UI.md built. `npx tsc --noEmit` clean for every T2 file
(the only repo error at handoff time was in `app/api/leads/route.ts` — T1's
uncommitted working copy). `node --check` clean on all touched extension JS.

## Dashboard

**New components**
- `components/ig.tsx` — `igProfileUrl` / `igDmUrl` (C7), `isSnoozed`, `IgHandle`
  (clickable @handle → profile, + ⧉ copy-handle button), and `LeadPlus` =
  `Lead & { snoozed_until, owner_name, rep_id }` so T2 compiles whether or not
  T1 has added those fields to `lib/types.ts`. **T1: adding them there is still
  the right end state.**
- `components/OwnerControl.tsx` — `ownerLabel()` (Yours / Unclaimed / {name}),
  `OwnerChip`, `OwnerControl` (admin → select posting C3
  `/api/leads/:id/assign { owner_id|null }` with "↺ Release to pool"; rep → chip only).
- `components/SnoozeControl.tsx` — +1d/+3d/+1w → C4 `/api/leads/:id/snooze
  { until }`, shows "zzz until <date>" + clear (until:null).
- `components/RepStatsPanel.tsx` — C6 `GET /api/stats/reps`, renders
  Owned/DMs Sent/Replied/Booked per rep; accepts a bare array or `{reps:[…]}`;
  hides itself entirely on 403/404/network (safe before T1 lands).

**Changed**
- `app/outreach/page.tsx` — queue excludes snoozed leads; primary "Open" now
  opens the **profile** (C7), new secondary "Open DM ↗"; @handle clickable +
  copy; SnoozeControl row (advances the queue after snoozing).
- `components/LeadCard.tsx` — @handle clickable + copy; `assigneeName` prop
  REPLACED by `ownerLabel` (Dashboard is the only caller — updated); zzz chip
  when snoozed; expanded card has admin Owner reassign row.
- `components/LeadDetailPanel.tsx` — "Assigned to" select + Auto-assign button
  REMOVED (old assigned_to model; round-robin is deferred per the locked
  decisions) → replaced with Owner (C3 control) + Snooze (C4) + read-only
  **Touches** chips off `outreach_channels` (`ig_fanbasis` / `ig_personal` /
  `linkedin`, `{sent, sentAt}` shape).
- `components/Dashboard.tsx` — "Mine" filter now `owner_id === userId` (was
  `assigned_to`); LeadCard gets `ownerLabel`; RepStatsPanel shown for
  admin + Team view.
- `app/leads/[id]/page.tsx` — header @handle clickable + copy.

## Extension (chrome-extension/ig-lead-tracker/, v2.2.0 → 2.3.0)

- `sidepanel.js` — `igProfileUrl()` (C7); handle links + ⧉ copy on Leads tab
  and outreach card; 9-stage `<select>` on both (C5, via new
  `apiPatchLead(id, updates)` → `PATCH /api/leads/:id`, Bearer repToken);
  notes textarea (debounced 800ms + blur → `{notes}`) and follow-up
  +1d/+3d/+7d/clear (`{due_at}`) on the outreach card; localStorage snooze
  replaced by server snooze.
- `background.js` — new `SNOOZE_LEAD` message → C4 POST, optimistic cache write.
- `outreach-queue.js` — `isSnoozed` reads `snoozed_until` (C1) first, legacy
  local map honored read-only until expiry.
- `instagram.js` — floating-card snooze also moved to the server endpoint.
- `styles.css` — `.handle-link`, `.copy-handle-btn`, `.stage-select`, notes/fu styles.

## For T1 / integration

- UI calls these exact shapes: `POST /api/leads/:id/assign {owner_id|null}`,
  `POST /api/leads/:id/snooze {until}`, `PATCH /api/leads/:id {stage|notes|due_at}`,
  `GET /api/stats/reps` → `[{rep_id, name, owned, dmSent, replied, booked}]`
  (camelCase metric keys assumed from the contract block — flag if you shipped
  snake_case).
- Dashboard stage PATCHes from the queue still go through collection
  `PATCH /api/leads` with `{id, ...}` — C2 stamping must live in
  `applyLeadPatch` (as specced) so both entrypoints claim ownership.
- Reps must NOT get `owner_name` (C1 says admin-only) — UI falls back to
  member-list lookup / "Claimed" when it's absent.
- After migration 016 is applied: joint end-to-end per SPLIT_T1_SERVER.md §Done.
