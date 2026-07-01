-- Run this in Supabase SQL editor

create table leads (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  updated_at timestamptz default now(),

  -- identity
  name text,
  ig_username text,
  linkedin_url text,
  phone text,
  email text,

  -- stage
  stage text not null default 'New',
  -- Sales: New | Warming | DM Sent | Qualifying | Call Offered | Booked | Closed | DQ
  -- CSM: Active | At Risk | Churned

  -- source / mode
  source text,   -- 'IG' | 'LinkedIn' | 'SMS' | 'Email' | 'Manual'
  mode text not null default 'sales',  -- 'sales' | 'csm'

  -- follow-up
  due_at timestamptz,
  last_contact_at timestamptz,

  -- IG-specific
  ig_events jsonb default '[]',   -- [{ type, postUrl, ts }]

  -- meta
  notes text,
  tags text[] default '{}'
);

create index leads_mode_stage on leads(mode, stage);
create index leads_due_at on leads(due_at);
create index leads_ig_username on leads(ig_username);

-- Enable realtime
alter publication supabase_realtime add table leads;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Add IG research + profile fields to leads
-- Run these in Supabase SQL editor if the table already exists
-- ─────────────────────────────────────────────────────────────────────────────
alter table leads
  add column if not exists ig_profile_url text,
  add column if not exists ig_user_id text,
  add column if not exists bio text,
  add column if not exists follower_count integer,
  add column if not exists score integer default 0,
  add column if not exists research_status text default 'none',
  add column if not exists research_cache jsonb;

-- ─────────────────────────────────────────────────────────────────────────────
-- Unified Inbox: messages table
-- channel: 'ig' | 'sms' | 'email' | 'linkedin'
-- direction: 'inbound' | 'outbound'
-- ─────────────────────────────────────────────────────────────────────────────
create table if not exists messages (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid references leads(id) on delete set null,
  created_at timestamptz default now(),
  direction text not null,   -- 'inbound' | 'outbound'
  channel text not null,     -- 'ig' | 'sms' | 'email' | 'linkedin'
  body text,
  external_id text unique,   -- provider message ID for dedup
  from_address text,
  to_address text,
  raw jsonb,                 -- full webhook payload for debugging
  read boolean default false
);

create index if not exists messages_lead_id on messages(lead_id);
create index if not exists messages_created_at on messages(created_at desc);
create index if not exists messages_direction_channel on messages(direction, channel);

alter publication supabase_realtime add table messages;

-- ─────────────────────────────────────────────────────────────────────────────
-- Migration: Salesforce cross-reference, outreach tracking, action timestamps
-- Run in Supabase SQL editor — all columns are idempotent (IF NOT EXISTS)
-- ─────────────────────────────────────────────────────────────────────────────
alter table leads
  -- Salesforce
  add column if not exists sf_account_id       text,
  add column if not exists sf_account_name     text,
  add column if not exists sf_status           text default 'none',
  add column if not exists sf_confidence_score integer default 0,
  add column if not exists sf_match_reasons    text[] default '{}',
  add column if not exists sf_last_checked     timestamptz,
  -- Outreach tracking (channel-level DM log, touch history)
  add column if not exists outreach_channels   jsonb default '{}',
  add column if not exists outreach_log        jsonb default '[]',
  -- Action timestamps (set by extension when user takes action in Outreach tab)
  add column if not exists dm_sent_at          timestamptz,
  add column if not exists dq_at               timestamptz;
