-- Migration 018: Quicklinks — the links shown in the extension's Links tab.
-- Managed entirely on the dashboard: admins set TEAM defaults (user_id null),
-- each rep adds their own PERSONAL links (user_id set). The extension reads
-- them via /api/extension/bootstrap and renders read-only — no in-extension
-- settings.
create table if not exists quicklinks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid references users(id) on delete cascade,  -- null = team default (admin-managed)
  label text not null,
  url text not null,
  sort int not null default 0,
  created_at timestamptz default now()
);
create index if not exists quicklinks_org_idx on quicklinks(org_id);
create index if not exists quicklinks_user_idx on quicklinks(user_id);

-- Seed the current team defaults for every org that has none yet.
insert into quicklinks (org_id, label, url, sort)
select o.id, v.label, v.url, v.sort
from orgs o
cross join (values
  ('Salesforce',    'https://saas-data-1186.lightning.force.com/lightning/page/home', 0),
  ('BNPL',          'https://www.fanbasis.com/bnpl',        1),
  ('Seller Signup', 'https://www.fanbasis.com/seller',      2),
  ('Enterprises',   'https://www.fanbasis.com/enterprises', 3),
  ('VIP Deposit',   'https://webinarcon.com/vip-deposit/',  4)
) as v(label, url, sort)
where not exists (
  select 1 from quicklinks q where q.org_id = o.id and q.user_id is null
);
