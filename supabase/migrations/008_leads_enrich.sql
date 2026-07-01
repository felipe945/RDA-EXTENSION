-- Migration 008: Add source_account column + normalize sf_match_reasons

-- Track which IG account saved each lead
alter table leads
  add column if not exists source_account text;

comment on column leads.source_account is
  'The IG handle that hit the Save button (e.g. "fanbasisig"). Set by Chrome extension.';

-- sf_match_reasons was created in 001 as text[] and 002 as jsonb.
-- If both ran, the 001 version persists (ADD COLUMN IF NOT EXISTS skips if exists).
-- Check your column type:
--   select column_name, data_type from information_schema.columns
--   where table_name='leads' and column_name='sf_match_reasons';
-- If it is 'text[]', cast to jsonb:
-- alter table leads alter column sf_match_reasons type jsonb using to_jsonb(sf_match_reasons);
-- If it is already 'jsonb', skip that step.

create index if not exists leads_source_account_idx on leads (source_account)
  where source_account is not null;
