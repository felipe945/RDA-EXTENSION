-- Migration 012: hard duplicate guarantee on IG identity
--
-- Until now dedup was app-logic only (ig-events did find-or-insert by ig_username),
-- so the table can hold duplicate (org_id, ig_username) rows, and the CLI/bulk paths
-- had no protection at all. This migration makes duplicates impossible system-wide.
--
--   1. pick a survivor per (org_id, lower(ig_username)) — latest updated wins
--   2. repoint child rows (messages, assignment_log) onto the survivor so nothing
--      is orphaned by the cascade delete
--   3. delete the duplicate leads
--   4. add a partial unique index so no future duplicate can ever be inserted
--
-- Dedup is keyed on lower(ig_username): Instagram handles are case-insensitive, so
-- "Felipe" and "felipe" are the same lead. Leads with NULL ig_username (manual /
-- email / linkedin-only) are exempt and can freely coexist.
--
-- Run in the Supabase SQL editor (or via the Management API query endpoint).

begin;

-- 1. Map every duplicate lead -> its survivor.
create temporary table lead_dedup_map on commit drop as
with ranked as (
  select
    id,
    row_number() over (
      partition by org_id, lower(ig_username)
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as rn,
    first_value(id) over (
      partition by org_id, lower(ig_username)
      order by updated_at desc nulls last, created_at desc nulls last, id desc
    ) as survivor_id
  from leads
  where ig_username is not null
)
select id as dup_id, survivor_id
from ranked
where rn > 1;

-- 2. Repoint children off the doomed duplicates onto the survivor.
update messages m
  set lead_id = d.survivor_id
  from lead_dedup_map d
  where m.lead_id = d.dup_id;

update assignment_log a
  set lead_id = d.survivor_id
  from lead_dedup_map d
  where a.lead_id = d.dup_id;

-- 3. Delete the duplicate leads.
delete from leads
  where id in (select dup_id from lead_dedup_map);

-- 4. Enforce uniqueness forever. Partial index: NULL ig_username rows are exempt.
create unique index if not exists leads_org_ig_unique
  on leads (org_id, lower(ig_username))
  where ig_username is not null;

commit;
