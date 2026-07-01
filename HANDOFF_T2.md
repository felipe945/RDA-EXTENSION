# HANDOFF_T2 — Frontend / UI Layer

## Files created / owned by T2

| File | Status | What it does |
|------|--------|-------------|
| `components/ModeProvider.tsx` | Complete | Sales/CSM mode React context. Persists to localStorage `ops-mode`. Exports `ModeProvider` + `useMode()`. |
| `components/Nav.tsx` | Complete | Sticky top nav: logo left, mode toggle right (blue=Sales, purple=CSM), links to /leads (Leads), /inbox (Inbox), /summary (Summary). |
| `hooks/useLeads.ts` | Complete | Shared `Lead` type. `useLead(id)` + `useLeads(mode)` both with Supabase Realtime. `useLeads` returns `{ leads, loading, refresh }`. |
| `components/LeadDetailPanel.tsx` | Complete | Tabbed panel: Overview (editable stage/phone/email/linkedin/notes autosave) · Research (pending/none/complete/error states) · Activity (ig_events list). |
| `components/ResearchPanel.tsx` | Complete (legacy) | Simpler research display kept for back-compat. LeadDetailPanel supersedes it. |
| `app/layout.tsx` | Complete | Wraps app in ModeProvider + Nav. |
| `app/page.tsx` | Complete | Home = Dashboard component, reads mode from context. |
| `app/leads/[id]/page.tsx` | Complete | Lead detail: back button, header with IG link, renders `<LeadDetailPanel lead={lead} />`. Uses `useLead(id)` with Realtime. |
| `app/inbox/page.tsx` | Complete | Unified inbox. Reads `messages` table with lead join. Inbound filter + mark-read. Degrades gracefully if table absent. |
| `app/summary/page.tsx` | Complete | Morning briefing. Tries `/api/ai/summary?mode=` first (T3). Falls back to live Supabase urgency data (overdue / today / upcoming). |

---

## Lead type contract (authoritative — T3 must match this)

```typescript
type Lead = {
  // Identity
  id: string;
  created_at: string;
  updated_at: string;
  name: string | null;
  ig_username: string | null;
  ig_profile_url: string | null;       // full URL, e.g. https://instagram.com/handle
  linkedin_url: string | null;
  phone: string | null;
  email: string | null;

  // Classification
  stage: string;
  source: string | null;
  mode: string;                        // "sales" | "csm"

  // Scheduling
  due_at: string | null;
  last_contact_at: string | null;

  // IG events
  ig_events: { type: string; postUrl: string | null; ts: string }[];

  // Notes & tags
  notes: string | null;
  tags: string[];

  // AI Research — T3 writes these two fields
  research_status: "none" | "pending" | "complete" | "error";
  research_cache: Record<string, unknown>;  // JSONB in Supabase; empty object {} when no data
};
```

---

## research_cache shape expected by LeadDetailPanel (Research tab)

T3's `/api/ai/research-lead` endpoint must store the following keys in the `research_cache` JSONB column. All fields are optional; missing keys are silently skipped.

```typescript
type ResearchCache = {
  estimatedGmv?: number;          // monthly GMV in dollars — rendered as "$12,000/mo est."
  fitScore?: number;              // 0–100 score — green ≥70, yellow ≥40, red <40
  stackDetected?: string[];       // tech stack tags, e.g. ["Shopify", "Klaviyo"]
  summary?: string;               // 2–4 sentence plain-text AI summary
  alreadyCustomer?: boolean;      // if true, a blue warning banner is shown
};
```

Flow expected by UI:
1. User clicks "Research Now" → POST `/api/ai/research-lead` `{ leadId }` → T3 sets `research_status = 'pending'`
2. T3 runs AI job → sets `research_status = 'complete'` and populates `research_cache`
3. If job fails → T3 sets `research_status = 'error'`
4. Supabase Realtime pushes all updates; UI re-renders automatically.

---

## What T2 needs from other terminals

### From T1
- `messages` table in schema: `id, created_at, lead_id (FK → leads.id), channel (ig|sms|email|linkedin), direction (inbound|outbound), body text, read boolean default false`
- Realtime enabled on `messages` table
- `research_cache` column: `jsonb default '{}'`
- `research_status` column: `text default 'none'`
- `ig_profile_url` column: `text`

### From T3
- `POST /api/ai/research-lead` — accepts `{ leadId: string }`, sets status to pending, runs job, updates research_cache
- `GET /api/ai/summary?mode=sales|csm` — returns `{ content: string, generatedAt: string }`

---

## Known graceful degradations

- Inbox shows empty state until T1 creates the `messages` table
- Summary shows live Supabase fallback until T3 builds `/api/ai/summary`
- Research tab shows "Research Now" CTA until T3 builds the endpoint (button will error but won't crash)
- `research_status` defaults to `"none"` client-side if DB returns null (pre-migration safety)
