-- Migration 013: Cross-rep idempotency for detected replies
-- The shared FanBasis IG account means every rep's extension detects the same
-- inbound reply and POSTs it to /api/messages. (lead_id, channel, item_id)
-- identifies one platform message, so duplicate detections upsert/no-op
-- instead of inserting N rows. Run AFTER migration 012.

alter table messages
  add column if not exists item_id text,
  add column if not exists thread_id text;

comment on column messages.item_id is
  'Platform-native message id (e.g. IG DM item_id). Uniqueness key with (lead_id, channel) for cross-rep dedup. Null for channels without one.';
comment on column messages.thread_id is
  'Platform-native conversation/thread id (e.g. IG DM thread_id).';

-- Partial unique index: enforces one row per detected platform message while
-- leaving item_id-less inserts (SMS, email, manual) unconstrained.
create unique index if not exists messages_lead_channel_item_uniq
  on messages (lead_id, channel, item_id)
  where item_id is not null;
