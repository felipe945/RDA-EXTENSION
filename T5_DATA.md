# T5 — Data Integrity, Schema & Types
## Files Owned
- `lib/types.ts`
- `app/api/ig-events/route.ts`
- `app/api/leads/[id]/touchpoints/route.ts`
- `supabase/migrations/008_leads_enrich.sql` (create)
- `supabase/migrations/009_messages_enrich.sql` (create)

## Do NOT touch
- `hooks/useLeads.ts` (owned by T4 — but coordinate on fields you add)
- `app/api/leads/route.ts` (owned by T4)

---

## Context
Multiple DB columns exist (from migrations 003–006) that were never wired into the API layer or Lead type. `outreach_log` is a key column that nothing writes to. `ig_user_id` is received from the extension but discarded. `sf_match_reasons` has a type mismatch between migration 001 (text[]) and migration 002 (jsonb). These silent holes corrupt data integrity over time.

---

## FIX 1: ig-events/route.ts — Save ig_user_id + savedFromAccount
**Problem:** Extension sends `userId` (IG's internal user ID) and (after T1) `savedFromAccount` but neither is saved to the DB.  
**Location:** `app/api/ig-events/route.ts` — the `IG_PROFILE_SAVE` block

In the update for existing lead:
```typescript
await db
  .from("leads")
  .update({
    bio: bio ?? null,
    follower_count: followerCount ?? null,
    ig_profile_url: profileUrl ?? null,
    name: displayName ?? username,
    score,
    research_status: "pending",
    ig_events: [...igEvents, saveEvent],
    updated_at: now,
    // ADD THESE:
    ig_user_id: body.userId || undefined,
    source_account: body.savedFromAccount || undefined,  // which IG account hit Save
  })
  .eq("id", leadId);
```

In the insert for new lead:
```typescript
await db.from("leads").insert({
  ig_username: username,
  name: displayName ?? username,
  source: "IG",
  mode: "sales",
  stage: "New",
  bio: bio ?? null,
  follower_count: followerCount ?? null,
  ig_profile_url: profileUrl ?? null,
  ig_user_id: (body as Record<string, unknown>).userId as string || null,   // ADD
  source_account: (body as Record<string, unknown>).savedFromAccount as string || null,  // ADD
  score,
  research_status: "pending",
  ig_events: [saveEvent],
  due_at: dueAt,
  updated_at: now,
});
```

Also fix the fire-and-forget URL (T4 noted this, T5 applies it since you own this file):
```typescript
// Replace:
const baseUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : (process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000");

// With:
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
  ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
```

---

## FIX 2: lib/types.ts — Add Missing Fields
**Problem:** `twitter_username`, `external_url`, `ig_user_id`, `source_account` exist in DB (migrations 003, 004, 001) but are absent from `lib/types.ts`'s Lead type.

In `lib/types.ts`, add to the Lead type:
```typescript
export type Lead = {
  // ... existing fields ...
  
  // Fields from migrations that were missing from type:
  twitter_username: string | null;   // migration 004
  external_url: string | null;       // migration 003
  ig_user_id: string | null;         // migration 001 (ig_user_id column)
  source_account: string | null;     // NEW — which IG account saved this lead
  
  // ... rest of fields ...
};
```

Note for T4: T5 is adding these to `lib/types.ts`. T4 must also add them to `hooks/useLeads.ts` normalization (which has its OWN Lead type — coordinate on who adds what).

**Coordination:** T4 owns `hooks/useLeads.ts`. T5 owns `lib/types.ts`. Both define a `Lead` type — they should be kept in sync. After T4 adds `twitter_username`, `external_url`, `ig_user_id` to `useLeads.ts`, T5 does NOT need to duplicate that work. T5's job is `lib/types.ts` only.

---

## FIX 3: touchpoints/route.ts — Actually Write to outreach_log
**Problem:** `app/api/leads/[id]/touchpoints/route.ts` exists and is called by `TouchpointsTab`. Need to verify it correctly writes to `outreach_log`.

Read the file first. It likely uses a pattern like:
```typescript
// POST: append to outreach_log jsonb array
const newTouchpoint = {
  id: crypto.randomUUID(),
  channel,
  result: result ?? "sent",
  note: note ?? null,
  tried_at: new Date().toISOString(),
};

// Fetch current outreach_log
const { data: current } = await db.from("leads").select("outreach_log").eq("id", leadId).single();
const log = Array.isArray(current?.outreach_log) ? current.outreach_log : [];

await db.from("leads")
  .update({ outreach_log: [...log, newTouchpoint], updated_at: new Date().toISOString() })
  .eq("id", leadId);
```

If the file doesn't do this — write it. If it does, verify `tried_at` is an ISO string (for the `relTime()` function in `TouchpointsTab`).

Also add PATCH support for updating a touchpoint's `result`:
```typescript
// PATCH: update result on a specific touchpoint by ID
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id: leadId } = await params;
  const { touchpointId, result } = await request.json() as { touchpointId: string; result: string };
  
  const { data: current } = await db.from("leads").select("outreach_log").eq("id", leadId).single();
  const log = Array.isArray(current?.outreach_log) ? [...current.outreach_log] : [];
  const idx = log.findIndex((t: Record<string,unknown>) => t.id === touchpointId);
  if (idx >= 0) log[idx] = { ...log[idx], result };
  
  await db.from("leads").update({ outreach_log: log, updated_at: new Date().toISOString() }).eq("id", leadId);
  return Response.json({ ok: true });
}
```

---

## FIX 4: Migration 008 — Add source_account + fix sf_match_reasons type
**Problem 1:** `source_account` column doesn't exist yet in DB.  
**Problem 2:** Migration 001 created `sf_match_reasons text[] default '{}'` but migration 002 tried to add it as `jsonb not null default '[]'`. The actual column type in DB depends on which migration was applied first. The Salesforce code uses it as a string array. Need to normalize this.

**Create `supabase/migrations/008_leads_enrich.sql`:**
```sql
-- Migration 008: Add source_account column + normalize sf_match_reasons

-- Track which IG account saved each lead
alter table leads
  add column if not exists source_account text;

comment on column leads.source_account is 
  'The IG handle that hit the Save button (e.g. "fanbasisig"). Set by Chrome extension.';

-- Note: sf_match_reasons was created in 001 as text[] and 002 as jsonb.
-- If both ran, the 001 version persists (ALTER TABLE ADD COLUMN IF NOT EXISTS skips if exists).
-- Salesforce code (lib/salesforce.ts) writes string arrays — both types work for reading
-- but jsonb is more flexible. Check your column type:
--   select column_name, data_type from information_schema.columns 
--   where table_name='leads' and column_name='sf_match_reasons';
-- If it's 'text[]', cast to jsonb:
-- alter table leads alter column sf_match_reasons type jsonb using to_jsonb(sf_match_reasons);
-- If it's already 'jsonb', this migration is a no-op.

-- Index for source_account to find FanBasis-account vs personal-account saves
create index if not exists leads_source_account_idx on leads (source_account)
  where source_account is not null;
```

---

## FIX 5: Migration 009 — Messages enrich
**Create `supabase/migrations/009_messages_enrich.sql`:**
```sql
-- Migration 009: Add sent_from_handle to messages (companion to T2's migration 007)
-- Run AFTER migration 007

-- Ensure sent_from_handle column exists (T2 creates migration 007 which adds this)
-- This migration adds additional improvements:

-- Add index on lead_id + direction for fast inbox queries
create index if not exists messages_lead_inbound_idx on messages (lead_id, direction)
  where direction = 'inbound';

-- Add outbound index for per-lead outreach history
create index if not exists messages_lead_outbound_idx on messages (lead_id, direction, created_at desc)
  where direction = 'outbound';

-- Ensure the read column has a default
alter table messages alter column read set default false;

-- Allow null external_id (some outbound messages have no external ID)
-- (It's already nullable in the schema, this is a confirmation comment)

comment on column messages.from_address is 
  'Sender identifier — IG handle, email address, or phone. Null for inbound IG DMs (we receive them, not send them).';
comment on column messages.to_address is 
  'Recipient identifier — IG handle (@username), email, or phone number.';
```

---

## FIX 6: Verify + Fix Inbox Anon Key RLS Issue
**Problem:** `app/inbox/page.tsx` queries messages via Supabase anon key (client-side), not through the API route. If RLS is enabled, it may block this query.

This file is owned by T6, but the ROOT CAUSE is a schema/RLS issue — T5 should check.

In Supabase SQL Editor, verify RLS policy on messages:
```sql
-- Check if RLS is enabled:
select relname, relrowsecurity from pg_class where relname = 'messages';

-- If RLS is enabled but no policy allows anon reads, add one:
-- (Only do this if messages are meant to be readable by the dashboard's browser client)
create policy "Service role bypass" on messages
  for all
  using (true)
  with check (true);
-- OR: disable RLS on messages (since all auth is server-side via service role anyway)
alter table messages disable row level security;
```

Also check leads table:
```sql
select relname, relrowsecurity from pg_class where relname = 'leads';
-- If RLS is enabled, the anon key used in useLead() / useLeads() for realtime won't work
-- (useLead uses API route which uses service role — OK)
-- (realtime subscription uses anon key — if RLS blocks it, changes won't fire)
```

Recommended: disable RLS on both tables (auth is handled at the API route layer via IG_EVENTS_SECRET). This is what the app was designed for.

---

## FIX 7: types.ts — Message type completeness
Add `sent_from_handle` to the Message type in `lib/types.ts`:
```typescript
export type Message = {
  // ... existing fields ...
  sent_from_handle: string | null;  // which IG/email account sent this (from migration 007/T2)
};
```

---

## VERIFICATION
```sql
-- Run in Supabase SQL Editor after migrations:
select column_name, data_type 
from information_schema.columns 
where table_name = 'leads'
order by ordinal_position;
-- Should see: ig_user_id, source_account, twitter_username, external_url

select column_name, data_type
from information_schema.columns
where table_name = 'messages'
order by ordinal_position;
-- Should see: sent_from_handle

-- Test outreach_log write:
-- Save a lead, go to lead detail → Outreach tab → log an IG DM
-- Then: select id, outreach_log from leads where ig_username = 'testuser';
-- outreach_log should contain a JSON array entry
```

```bash
# Code verification:
# npm run build — no TypeScript errors from new fields
# Check ig-events route: save a lead from extension, verify ig_user_id is populated in DB
```

## COORDINATES WITH
- **T4**: T4 owns `hooks/useLeads.ts`. T5 adds `twitter_username`, `external_url`, `ig_user_id`, `source_account` to `lib/types.ts`. T4 must mirror these in `useLeads.ts` Lead type + normalizeLead function. COMMUNICATE which fields each terminal is adding.
- **T1**: Extension sends `savedFromAccount` in IG_PROFILE_SAVE payload. T5 saves it as `source_account` in ig-events/route.ts.
- **T2**: Migration 007 (T2) adds `sent_from_handle` to messages. Migration 009 (T5) adds indexes. Run 007 BEFORE 009.
- **T6**: Inbox RLS fix (T5 checks schema) enables inbox to actually show messages.
