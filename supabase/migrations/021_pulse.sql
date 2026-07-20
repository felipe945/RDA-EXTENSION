-- 021: Pulse — Felipe-only client-conversation watchdog (Slack + WhatsApp).
-- Strictly read-only surface: these tables only ever RECEIVE messages from the
-- pulse-bridge worker; nothing in the app sends messages anywhere.
--
-- am_conversations: one row per Slack channel/DM or WhatsApp 1:1 chat.
-- am_messages:      raw ingested messages, idempotent on (conversation, external_id).
-- am_sources:       worker heartbeats per feed — a stale row drives the
--                   "feed offline, statuses may be stale" banner (accuracy: a
--                   dead feed must never masquerade as all-green).
BEGIN;

create table public.am_conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.orgs(id),
  channel text not null check (channel in ('slack','whatsapp')),
  external_id text not null,            -- slack channel id (C…/D…/G…) or WA jid (…@s.whatsapp.net)
  display_name text,                    -- slack channel name / WA push name
  client_name text,                     -- Felipe's own label, set in UI
  tracked boolean not null default false,
  muted boolean not null default false,
  snoozed_until timestamptz,
  checkin_days int not null default 14,
  client_notes text,                    -- Felipe's context — fed to the classifier
  last_msg_at timestamptz,
  last_direction text check (last_direction in ('in','out')),
  last_msg_preview text,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  handled_at timestamptz,               -- "Mark handled": suppresses owe/commitment until the NEXT message
  ai_needs_reply boolean,
  ai_waiting_on text check (ai_waiting_on in ('you','them','none')),
  ai_open_commitment text,              -- what Felipe promised and hasn't delivered (null if none)
  ai_summary text,
  ai_suggested_reply text,
  ai_classified_msg_id text,            -- external_id of the message the ai_* fields describe (cache key)
  meta jsonb not null default '{}',     -- {team_id, last_read_at} for slack, {phone} for wa
  created_at timestamptz not null default now(),
  unique (org_id, channel, external_id)
);

create table public.am_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.am_conversations(id) on delete cascade,
  external_id text not null,            -- slack msg ts / WA message key id (idempotency)
  direction text not null check (direction in ('in','out')),
  author text,
  body text,
  sent_at timestamptz not null,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (conversation_id, external_id)
);
create index am_messages_convo_sent on public.am_messages (conversation_id, sent_at desc);

create table public.am_sources (
  channel text primary key check (channel in ('slack','whatsapp')),
  last_heartbeat_at timestamptz,
  detail jsonb not null default '{}'    -- e.g. {channels_polled: 42} / {wa_connected: true}
);

-- Same posture as 020: RLS on with no policies + anon revoked = the browser
-- anon key is a dead end; only the service-role server path reads these.
ALTER TABLE public.am_conversations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.am_conversations FORCE ROW LEVEL SECURITY;
ALTER TABLE public.am_messages      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.am_messages      FORCE ROW LEVEL SECURITY;
ALTER TABLE public.am_sources       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.am_sources       FORCE ROW LEVEL SECURITY;
REVOKE ALL ON public.am_conversations FROM anon, authenticated;
REVOKE ALL ON public.am_messages      FROM anon, authenticated;
REVOKE ALL ON public.am_sources       FROM anon, authenticated;

COMMIT;
