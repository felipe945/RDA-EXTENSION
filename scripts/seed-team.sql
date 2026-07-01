-- Seed: bootstrap FanBasis org + Felipe as owner.
-- Run this ONCE in the Supabase SQL editor AFTER 011_teams.sql and BEFORE any sign-in.
-- Without it, the signIn callback in lib/auth.ts has no existing users row and no
-- invite for Felipe, so his own first login would be rejected by the invite-only gate.
-- Copy-paste runnable — no manual ID substitution.

insert into orgs (name) values ('FanBasis')
on conflict do nothing;

insert into users (email, name)
values ('felipe@fanbasis.com', 'Felipe Guimaraes')
on conflict (email) do nothing;

insert into memberships (org_id, user_id, role)
select o.id, u.id, 'owner'
from orgs o, users u
where o.name = 'FanBasis' and u.email = 'felipe@fanbasis.com'
on conflict (org_id, user_id) do nothing;

update leads set org_id = (select id from orgs where name = 'FanBasis' limit 1)
where org_id is null;
