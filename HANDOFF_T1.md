# T1 Handoff — Backend / DB Layer

## Files Created or Modified

| File | Action |
|------|--------|
| `supabase/migrations/001_init.sql` | Created — full schema with leads + messages tables |
| `lib/apify.ts` | Created — Apify IG profile scraper |
| `lib/scoring.ts` | Created — lead scoring function |
| `app/api/leads/route.ts` | Created — GET / POST / PATCH / DELETE |
| `app/api/sendblue/route.ts` | Created — SendBlue SMS inbound webhook |
| `app/api/gmail/route.ts` | Created — Gmail reply inbound webhook |
| `app/api/ig-events/route.ts` | Updated — added IG_PROFILE_SAVE handling |

---

## Messages Table Schema (for T2 inbox queries)

```sql
messages (
  id           uuid primary key default gen_random_uuid(),
  created_at   timestamptz default now(),
  lead_id      uuid references leads(id) on delete set null,
  channel      text not null,    -- 'ig' | 'sms' | 'email' | 'linkedin'  (LOWERCASE)
  direction    text not null,    -- 'inbound' | 'outbound'
  body         text,
  external_id  text unique,      -- dedup key
  from_address text,
  to_address   text,
  raw          jsonb,            -- full webhook payload
  read         boolean default false
)
```

Index: `messages_lead_id`, `messages_created_at desc`, `messages_direction_channel`

Realtime: `alter publication supabase_realtime add table messages` — subscribe via supabase channel for live inbox updates.

Suggested T2 query for inbox:
```typescript
db.from("messages")
  .select("*, leads(name, ig_username)")
  .eq("direction", "inbound")
  .order("created_at", { ascending: false })
  .limit(100)
```

**IMPORTANT:** channel values are lowercase (`'sms'`, `'email'`, `'ig'`, `'linkedin'`). The inbox/page.tsx CHANNEL_LABELS map uses these exact values. Do not use uppercase.

---

## research_cache JSON Shape (for T3 to write)

T3's `lib/prompts/research.ts` already defines the AI prompt. The JSON shape T3 should write to `leads.research_cache` (from the prompt's return contract):

```typescript
interface ResearchCache {
  estimatedGmv: number;        // estimated monthly revenue in USD from audience monetization
  fitScore: number;            // 0-100 FanBasis fit score
  fitReason: string;           // 1-2 sentences explaining the score
  stackDetected: string[];     // e.g. ["Shopify", "Linktree", "ManyChat"]
  summary: string;             // 2-3 sentence sales brief for Felipe
  suggestedOpener: string;     // personalized IG DM opener (<150 chars)
  alreadyCustomer: boolean;    // true if creator is already a FanBasis customer
}
```

Scoring impact on `leads.score` (from `lib/scoring.ts`):
- `estimatedGmv >= 10000` → +20 pts
- `estimatedGmv >= 1000` → +10 pts
- `stackDetected` array present (non-null) → +10 pts
- `alreadyCustomer === true` → -50 pts

T3 should PATCH `/api/leads` with `{ id, research_status: 'complete', research_cache: { ... } }` after completing research. On error, PATCH with `{ id, research_status: 'error' }`.

**Note:** `lib/types.ts` (T1) now defines `research_cache` as `Record<string, unknown>` — no forced shape. The legacy `ResearchPanel.tsx` component uses old field names (`gmv_est`, `fit_score`) but `LeadDetailPanel.tsx` (the active component) reads the prompt-accurate names (`fitScore`, `estimatedGmv`, `stackDetected`, `summary`). Use the shape above.

---

## ENV Vars T1 Needs

| Variable | Purpose |
|----------|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase project URL (already in use) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anon key (already in use) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase service role key (already in use) |
| `IG_EVENTS_SECRET` | Shared secret for Chrome extension → ig-events webhook (already in use) |
| `APIFY_TOKEN` | Apify API token for Instagram profile scraper |
| `SENDBLUE_WEBHOOK_SECRET` | SendBlue webhook signing secret for HMAC verification |
| `NEXT_PUBLIC_BASE_URL` | Full app base URL (e.g. `https://app.fanbasis.com`) for internal fetch calls; falls back to `http://localhost:3000` |

---

## Notes for T2

- `leads` table now has: `ig_profile_url`, `bio`, `follower_count`, `research_status`, `research_cache`, `score` columns
- `research_status` values: `'none'` | `'pending'` | `'complete'` | `'error'`
- GET `/api/leads` supports `?mode=sales|csm`, `?stage=X`, `?bucket=overdue|today|upcoming|booked|archived`
- PATCH `/api/leads` auto-recalculates score on every update
- Realtime is enabled on both `leads` and `messages` tables

---

## Open Items for T4 (wiring pass)

1. **Supabase migration** — Run `lib/supabase-schema.sql` in Supabase SQL editor (the ALTER TABLE + CREATE TABLE IF NOT EXISTS blocks)

2. **Gmail sync cron** — `vercel.json` references `/api/gmail/sync` (GET) but only `/api/gmail` (POST webhook) exists. Either rename or create the sync endpoint. For now the webhook at `/api/gmail` is the active path.

3. **Score update after research** — `app/api/ai/research-lead/route.ts` writes `research_cache` but doesn't update `leads.score` with Claude's `fitScore`. Add: `score: parsed.fitScore ?? score` to the update call.

4. **`vercel.json` T3 cron** — T3 should add their daily briefing cron: `{ "path": "/api/ai/daily-briefing", "schedule": "0 8 * * *" }`

5. **TypeScript build** — Run `npm run build` and fix any type errors between T1/T2/T3 files. Known mismatch risk: `hooks/useLeads.ts` Lead type vs `lib/types.ts` Lead type (slightly different fields — useLeads doesn't include `bio`, `follower_count`, `score`, `ig_user_id`).
