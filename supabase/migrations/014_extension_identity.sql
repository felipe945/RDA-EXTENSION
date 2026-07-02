-- Migration 014: Extension identity — one-Google-sign-in setup (CONNECT wave)
-- 1. user_integrations: server-side per-user integration grants (Google
--    refresh/access tokens live in config jsonb). Mirrors Stackit's table
--    (name, columns, unique key) so a later convergence is a migration, not
--    a rewrite. team_id here references orgs(id) (this repo's "teams").
-- 2. users: personal_ig_username (extension bootstrap) +
--    extension_token_version (bump to revoke every repToken a rep holds).
-- 3. leads/messages: nullable rep_id stamped by repToken-authenticated
--    /api/ig-events writes. Fully additive; nothing existing breaks.
-- Run in the Supabase SQL editor (same as 013).

create table if not exists user_integrations (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  integration_type text not null,
  config jsonb default '{}'::jsonb,
  is_connected boolean default false,
  connected_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (team_id, user_id, integration_type)
);

create index if not exists user_integrations_user_type
  on user_integrations(user_id, integration_type);

-- config holds OAuth tokens — lock the table down. The app only touches it
-- with the service-role key (auth is NextAuth, not Supabase Auth, so the
-- auth.uid() policies are inert today; they're included for Stackit parity
-- and become live if this ever moves to Supabase Auth).
alter table user_integrations enable row level security;

create policy "Users can view own integrations"
  on user_integrations for select using (auth.uid() = user_id);
create policy "Users can create own integrations"
  on user_integrations for insert with check (auth.uid() = user_id);
create policy "Users can update own integrations"
  on user_integrations for update using (auth.uid() = user_id);
create policy "Users can delete own integrations"
  on user_integrations for delete using (auth.uid() = user_id);
create policy "Service role manages user integrations"
  on user_integrations for all using (auth.role() = 'service_role');

-- updated_at trigger (first trigger in this DB — create the helper here)
create or replace function update_updated_at_column()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists update_user_integrations_updated_at on user_integrations;
create trigger update_user_integrations_updated_at
  before update on user_integrations
  for each row execute function update_updated_at_column();

-- users: extension identity fields
alter table users
  add column if not exists personal_ig_username text,
  add column if not exists extension_token_version int not null default 1;

-- leads/messages: which rep's extension produced the write (null = legacy
-- x-ig-secret path or pre-migration rows)
alter table leads
  add column if not exists rep_id uuid references users(id);
alter table messages
  add column if not exists rep_id uuid references users(id);

create index if not exists leads_rep_id on leads(rep_id);
create index if not exists messages_rep_id on messages(rep_id);
