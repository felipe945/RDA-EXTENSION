-- Migration 007: Track which account sent each outbound DM
alter table messages
  add column if not exists sent_from_handle text;

-- Index for filtering by sender account
create index if not exists messages_sent_from_idx on messages (sent_from_handle)
  where sent_from_handle is not null;

comment on column messages.sent_from_handle is
  'The IG/email/phone handle that sent this message (e.g. @fanbasisig). Set when DM Sent is marked.';
