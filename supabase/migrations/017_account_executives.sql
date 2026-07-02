-- Migration 017: Account Executives — the people discovery calls are booked
-- with. Admin-managed in Team Settings; AEs don't need dashboard accounts.
-- Booking availability comes from Google Calendar free/busy on ae.email
-- (normal fanbasis.com Workspace sharing), queried with the booking rep's
-- own Google grant.

create table if not exists account_executives (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  name text not null,
  email text not null,
  active boolean not null default true,
  created_at timestamptz default now(),
  unique (org_id, email)
);

create index if not exists account_executives_org_idx on account_executives(org_id);
