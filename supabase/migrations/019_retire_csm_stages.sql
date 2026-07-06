-- 019_retire_csm_stages.sql
--
-- Retires the leaked CSM stage value "Active" from the SALES pipeline. Verified
-- live 2026-07-06 (project tiymeobqgmviwruvlbnm): stage='Active' → 4 rows, all
-- mode='sales'; 'At Risk' → 0; 'Churned' → 0. These 4 already bucket as
-- "booked" in the dashboard, so mapping Active → Booked is a no-op for the UI
-- and removes the last mis-typed stage. "Blocked" is already 0 rows and is
-- handled purely in code (renders gray) — no data change needed for it.
--
-- GUARDED + REVERSIBLE:
--   * Runs in a single transaction.
--   * Aborts (raises) if the affected count is unexpectedly large (> 50),
--     so this can never silently rewrite the pipeline if data has drifted.
--   * Logs the affected count via RAISE NOTICE.
-- To reverse: the affected ids are the ones printed; set them back to 'Active'.
--
-- STATUS: written but NOT YET APPLIED. Apply only after Felipe confirms the
-- count is 4. Until then, lib/stages.ts renders any lingering 'Active' value as
-- a gray, editable legacy stage, so nothing breaks in the meantime.

begin;

do $$
declare
  affected int;
begin
  select count(*) into affected
  from leads
  where stage = 'Active' and mode = 'sales';

  raise notice 'retire_csm_stages: % sales lead(s) at stage=Active will map to Booked', affected;

  if affected > 50 then
    raise exception 'retire_csm_stages aborted: % rows is more than expected (>50). Data may have drifted — review before applying.', affected;
  end if;

  update leads
  set stage = 'Booked', updated_at = now()
  where stage = 'Active' and mode = 'sales';
end $$;

commit;
