-- Migration 010: Add enrichment columns for social profile discovery
-- Run in Supabase: Dashboard → SQL Editor → paste & run

alter table leads
  add column if not exists youtube_url  text,
  add column if not exists website_url  text,
  add column if not exists enriched_at  timestamptz;

create index if not exists leads_enriched_at_idx on leads (enriched_at)
  where enriched_at is not null;
