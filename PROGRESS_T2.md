# T2 Progress — Frontend / UI Layer

**Owner:** Terminal 2
**Files:** `app/layout.tsx` · `app/page.tsx` · `app/leads/` · `app/inbox/` · `app/summary/` · `components/` · `hooks/`

## Checklist

- [x] `hooks/useLeads.ts` — shared Lead type + `useLead(id)` + `useLeads(mode)` with Realtime
- [x] `components/ModeProvider.tsx` — sales/csm context, persisted to localStorage
- [x] `components/Nav.tsx` — top nav: links + mode toggle
- [x] `app/layout.tsx` — updated with ModeProvider + Nav
- [x] `app/page.tsx` — simplified, reads mode from context
- [x] `components/ResearchPanel.tsx` — research tab (pulsing while pending)
- [x] `app/leads/[id]/page.tsx` — lead detail: Timeline · Research · Notes · Contact tabs
- [x] `app/inbox/page.tsx` — unified inbox (reads messages table when T1 creates it)
- [x] `app/summary/page.tsx` — morning briefing (calls /api/ai/summary when T3 builds it)
- [x] Wire LeadCard → leads/[id] link (added `→` arrow link, stops propagation)
- [x] HANDOFF_T2.md

## Gaps / Needs from Other Terminals

- **From T1:** `messages` table in schema + `/api/leads/[id]` route (for update operations from server)
- **From T3:** `/api/ai/summary` endpoint (summary page shows fallback until this exists)
- **Lead type:** `research_cache: string | null` and `research_status: 'pending' | 'complete' | null` — T2 reads these, T3 writes them. Schema migration needed.

## Notes

- Mode defaults to "sales", persists in localStorage under key `ops-mode`
- Lead detail page uses `use(params)` for Next.js 15+ async params
- Inbox and Summary pages degrade gracefully when backend routes don't exist yet
