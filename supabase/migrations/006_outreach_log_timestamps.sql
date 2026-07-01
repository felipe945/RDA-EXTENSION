-- Migration 006: Outreach touch history + action timestamps
-- Run in Supabase SQL editor: Dashboard → SQL Editor → paste & run

alter table leads
  add column if not exists outreach_log jsonb default '[]',
  add column if not exists dm_sent_at   timestamptz,
  add column if not exists dq_at        timestamptz;
