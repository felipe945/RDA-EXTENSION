-- Migration 009: Message table indexes + defaults
-- Run AFTER migration 007 (which adds sent_from_handle)

-- Fast inbox queries — unread inbound by lead
create index if not exists messages_lead_inbound_idx on messages (lead_id, direction)
  where direction = 'inbound';

-- Per-lead outreach history (ordered)
create index if not exists messages_lead_outbound_idx on messages (lead_id, direction, created_at desc)
  where direction = 'outbound';

-- Ensure read defaults to false
alter table messages alter column read set default false;

comment on column messages.from_address is
  'Sender identifier — IG handle, email address, or phone. Null for inbound IG DMs.';
comment on column messages.to_address is
  'Recipient identifier — IG handle (@username), email, or phone number.';
