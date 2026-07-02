-- Migration 016: Ownership & snooze (SPLIT wave — roles/ownership/scoping)
-- Fully additive. owner_id and rep_id already exist (011/014); this adds the
-- server-side snooze column (C4 — replaces extension-only localStorage) and
-- the indexes behind C1's org+owner scoped list queries.
-- Live schema diffed 2026-07-02 via PostgREST OpenAPI: snoozed_until missing,
-- owner_id/rep_id/org_id present, all 627 leads have org_id.
-- Run in the Supabase SQL editor (same as 013/014).

alter table leads
  add column if not exists snoozed_until timestamptz;

create index if not exists leads_owner_id on leads(owner_id);
create index if not exists leads_org_owner on leads(org_id, owner_id);
