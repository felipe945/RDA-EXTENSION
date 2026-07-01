-- Migration 002: Salesforce cross-reference columns
-- Run in Supabase SQL editor: Dashboard → SQL Editor → paste & run

alter table leads
  add column if not exists sf_account_id       text,
  add column if not exists sf_account_name     text,
  add column if not exists sf_status           text not null default 'none',
  add column if not exists sf_confidence_score integer not null default 0,
  add column if not exists sf_match_reasons    jsonb not null default '[]',
  add column if not exists sf_last_checked     timestamptz;

-- Index for fast "show all customers" queries
create index if not exists leads_sf_status_idx on leads (sf_status);
