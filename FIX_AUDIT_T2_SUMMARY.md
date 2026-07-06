# FIX_AUDIT — Terminal 2 Summary · Dashboard UI Legibility

`CHECKPOINT_T2_DONE: f4d1f05`

All five UI tasks shipped and verified by driving the running app (Playwright, authed
session, 1440×900 **and** 1024×768, real 1060-lead data). `tsc --noEmit` clean,
`next build` clean. 20/20 automated checks passed.

## What changed

**UI-1 — one primary action** (`app/outreach/page.tsx`)
"✓ DM Sent" demoted from co-equal green `grid-cols-2` cell to a quiet, narrower outline
button (`bg-transparent border-gray-700 text-gray-300`) beside the pink primary — same
hierarchy the lead-detail page uses. Verified: exactly one button computes
`rgb(255,58,105)` background on the card.

**UI-2 — Book un-mangled** (`app/outreach/page.tsx`)
Book dropped the red gradient pill for a normal-sized slate outline secondary
(`border-gray-700 px-3 py-1.5`), `shrink-0` in a `justify-between gap-2` row with
Snooze. Verified at both widths: no gradient, no sibling overlap, aligned inside row.

**UI-3 — counts agree** (`components/Dashboard.tsx`)
- Banner sentence and Research-All button now quote the **same set** (`batchLeads` =
  not-complete ∧ not-pending): live render shows "**636** leads need AI research ·
  **423** researching now" next to "Research All (**636**)". In-flight jobs labeled
  separately instead of silently inflating the sentence.
- Stage pill renamed **"All active (831)"** — no longer claims the same word as the
  channel tab's honest "All 1060" total.
- Bonus mismatch fixed: source-tab counts and the source filter now share ONE
  `sourceMatch()` predicate (the Manual tab count previously used a narrower predicate
  than what clicking Manual showed).

**UI-4 — bounded render** (`components/Dashboard.tsx`)
Buckets render ≤50 cards up front (`BUCKET_RENDER_CAP`), "Show 200 more (N hidden)"
reveals in steps. Bucket headers keep quoting `grouped[b].length` — true totals.
Page height dropped **52,206px → 8,924px**. Verified click: 130 → 330 rendered cards.

**UI-5 — FAB clearance** (`components/Dashboard.tsx`)
`pb-24` on the dashboard root; last card hit-tests clickable (elementFromPoint returns
the card, not the FAB) and screenshots show clear space under the final row.

## Verification artifacts
Script: scratchpad `verify-t2.mjs` (mints a NextAuth session cookie via the project's
`next-auth/jwt.encode`, drives `localhost:3111`). Screenshots (scratchpad, session-scoped):
`outreach-1440.png`, `outreach-1024.png`, `home-1440.png`, `home-1024.png`,
`home-bottom-1440.png`, `home-bottom-1024.png`.

## Coordination notes
- `CHECKPOINT_T1_RLS` did not exist at build/verify time — nothing realtime-related assumed.
- Brand: no new pink introduced; existing `#FF3A69` usages untouched (D-brand pending).
- A dev server for this repo runs on **:3111** (restarted by T2 during QA — same port,
  same dir; sorry for the ~30s blip).

## Out of scope (unchanged)
G3 pipeline analytics — roadmap.
