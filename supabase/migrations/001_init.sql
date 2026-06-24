-- Migration 001: Initial schema
-- Run this in Supabase SQL editor or via supabase db push

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
  ig_profile_url text,            -- IG profile URL
  bio text,                       -- IG bio captured at save time
  follower_count int,             -- follower count captured at save time

  -- AI research
  research_status text not null default 'none',  -- 'none' | 'pending' | 'complete' | 'error'
  research_cache jsonb default '{}',             -- stores AI research result

  -- scoring
  score int default 0,

  -- meta
  notes text,
  tags text[] default '{}'
);

create index leads_mode_stage on leads(mode, stage);
create index leads_due_at on leads(due_at);
create index leads_ig_username on leads(ig_username);
create index leads_phone on leads(phone);
create index leads_email on leads(email);
create index leads_research_status on leads(research_status);

-- Enable realtime for leads
alter publication supabase_realtime add table leads;

-- Messages table for inbound/outbound comms across all channels
create table messages (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz default now(),
  lead_id uuid references leads(id) on delete cascade,
  channel text not null,    -- 'SMS' | 'IG' | 'Email' | 'LinkedIn'
  direction text not null,  -- 'in' | 'out'
  body text,
  raw jsonb default '{}'
);

create index messages_lead_created on messages(lead_id, created_at);

-- Enable realtime for messages
alter publication supabase_realtime add table messages;
