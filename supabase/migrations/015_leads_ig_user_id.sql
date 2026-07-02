-- Migration 015: leads.ig_user_id — the column /api/ig-events has written
-- since 4961172 but no migration ever created. Without it PostgREST rejects
-- the whole insert/update (PGRST204), so every extension IG_PROFILE_SAVE for
-- a new lead 500s, and updates fail whenever the extension sends userId.
-- Stores Instagram's numeric user id (stable across username changes; used
-- for reply-thread matching). Fully additive.
-- Run in the Supabase SQL editor (same as 013/014).

alter table leads
  add column if not exists ig_user_id text;

create index if not exists leads_ig_user_id_idx on leads (ig_user_id)
  where ig_user_id is not null;
