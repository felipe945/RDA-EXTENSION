-- Migration 011: Teams — orgs, users, memberships, invites, assignment_log
-- Fully additive. Every column added to `leads` is nullable; nothing breaks the
-- 585 in-flight prospects before scripts/seed-team.sql runs.
-- Run this in the Supabase SQL editor, then run scripts/seed-team.sql.

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text,
  created_at timestamptz default now()
);

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'rep',   -- 'owner' | 'admin' | 'rep'
  capacity int not null default 50,   -- open-lead cap for round-robin
  created_at timestamptz default now(),
  unique (org_id, user_id)
);

create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,
  role text not null default 'rep',
  token uuid not null default gen_random_uuid(),
  invited_by uuid references users(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz default now()
);
create unique index if not exists invites_token_idx on invites(token);
create index if not exists invites_email_idx on invites(email);

alter table leads
  add column if not exists org_id uuid references orgs(id),
  add column if not exists assigned_to uuid references users(id),
  add column if not exists owner_id uuid references users(id);

create index if not exists leads_org_id on leads(org_id);
create index if not exists leads_assigned_to on leads(assigned_to);

create table if not exists assignment_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  from_user uuid references users(id),
  to_user uuid references users(id),
  assigned_by uuid references users(id),
  created_at timestamptz default now()
);
create index if not exists assignment_log_lead_id on assignment_log(lead_id);
