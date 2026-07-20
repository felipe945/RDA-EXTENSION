# PULSE — Felipe's private read-only watchdog (Slack + WhatsApp, "never leave a client on read")

> **How to use this file (Felipe):** open ONE Claude Code terminal in `~/unified-sales-ops` and say:
> *"Read PULSE_BUILD.md and implement everything in it, in phase order. When done, write HANDOFF_PULSE.md."*
> Sections marked **🧍 FELIPE-ONLY** are console/phone steps the agent can't do — it should pause and print instructions when it hits them.

## MISSION

Add an **admin-only "Accounts" section** to FanMas — visible ONLY to Felipe (role owner/admin) — that monitors his **Commas client** conversations (FanBasis/Commas account management — NOT Servedia) from **Slack** (as HIS persona, via his own user OAuth token — no bot, no app presence in any channel) and **WhatsApp** (his personal number, read-only bridge) and surfaces the next urgent fires and actions:

- 🔥 **Fires** — a client's last message is inbound and unanswered too long; worst case flagged distinctly: **opened/read and never responded** (👀 seen · no reply)
- 🟠 **Next actions** — you spoke last and they went quiet (nudge due), or no touch in N days (check-in due)
- 🟢 **All good**
- ➕ **Untracked** — new threads Felipe hasn't marked as clients yet

Every card: AI one-line summary + suggested reply (**copy-only** — he pastes it himself), deep link to open the real thread, Mark handled / Snooze / Mute.

## ⛔ READ-ONLY GUARANTEES (non-negotiable, enforce in code review before handoff)

1. **The system NEVER sends a message anywhere** — not Slack, not WhatsApp, not email. No digest DMs. The only alert surface is the `/accounts` board + a count badge on its nav item.
2. **Zero write scopes.** The Slack token is user-scoped read-only (list below — no `chat:write`, no `*:write` of any kind). The WhatsApp bridge never calls `sendMessage`/`sendPresenceUpdate` — grep the worker for `send` before handoff; only `fetch` POSTs to FanMas are allowed.
3. **Slack credentials never leave Felipe's Mac.** The user token lives only in `workers/pulse-bridge/.env`. The Vercel server never sees or stores it — it only receives already-read messages over the bridge secret.
4. Suggested replies are text in a copy box. There is no "Send" button anywhere in this feature.

## DECISIONS (locked defaults — flip only if Felipe says so)

- **D1 WhatsApp = Baileys bridge** on Felipe's Mac (npm `baileys`, formerly `@whiskeysockets/baileys`): unofficial WhatsApp-Web protocol, listens to his existing personal number, read-only. Small ban risk — accepted. Official Business Cloud API rejected (needs a new number clients don't use).
- **D2 Slack = Felipe's persona, no app presence.** A minimal Slack "app" registration is unavoidable as the OAuth client that mints his user token (that's how Slack OAuth works) — but it has **no bot user, no events URL, nothing installed into channels, nothing visible to anyone**. Ingestion = the Mac worker polling `users.conversations` + `conversations.history` with his `xoxp` token every 5 minutes, reading exactly what he can read in the **Commas (FanBasis) workspace**: Slack Connect client channels, client DMs, internal channels (those stay untracked). Servedia is OUT of scope — this build is Commas account management only. Plan B if the workspace blocks member app installs: browser session token (xoxc/xoxd) — same poller, document but don't build.
- **D3 Thresholds (constants in `lib/am/status.ts`, tune later):** inbound unanswered ≥ **4h → amber**, ≥ **24h → red**; outbound then silence ≥ **3 days → amber (nudge)**; no messages either direction ≥ **`checkin_days` (default 14) → amber (check-in)**; snoozed/muted → hidden. Red never fires between 11pm–7am ET (clamp, don't skip — it fires at 7am). **Seen-but-ignored escalation (Slack only v1):** if Felipe's read cursor shows he already OPENED the last inbound and still hasn't replied, red fires at **12h** instead of 24h, and the card carries a "👀 seen · no reply" badge — consciously opened + never answered is the exact sin this tool exists to catch.
- **D4 No new infra:** status is **derived at read time** (no sweep worker), AI classify runs **at ingest** (fire-and-forget internal route). **No cron at all** (the old digest idea is CUT per guarantee #1 — Vercel Hobby's 2nd cron slot stays free). Inngest NOT used (its keys are unset in prod).
- **D5 One worker, one ingest endpoint.** `workers/pulse-bridge/` runs BOTH the Baileys socket and the Slack poll loop in one process; both POST normalized batches to `/api/pulse/events` with `Authorization: Bearer PULSE_BRIDGE_SECRET`.
- **D6 Accuracy doctrine (Felipe: "extremely accurate, purely for clients").** (a) The board shows ONLY conversations Felipe explicitly tracked as clients — everything else is invisible, period. (b) The deterministic engine (real message directions + timestamps) is the primary truth; AI only refines it (needs_reply, waiting_on). (c) Feeds must be self-healing (Slack per-channel cursors backfill any downtime; WA processes offline catch-up upserts) and **monitored via heartbeats — a dead feed shows a red "feed offline, statuses stale" banner, never silently-green lies.** (d) The classifier is biased to flag when uncertain: a false fire costs a glance, a missed fire costs a client. (e) Catch the sneak case: Felipe replied last with a promise ("will do!") → he still owes a deliverable → flagged.

## REPO FACTS (verified 2026-07-20 — trust these)

- Next.js **16.2.9** — middleware file is **`proxy.ts`** (not middleware.ts). Per `AGENTS.md`: read `node_modules/next/dist/docs/` guides before writing route/middleware code.
- Auth = NextAuth v4. Session fields: `userId`, `orgId`, `role: "owner"|"admin"|"rep"`. Admin check helper: `canManageTeam(role)` in `lib/permissions.ts`.
- **Session-only admin gate idiom** (copy from `app/api/team/route.ts:8-12`):
  ```ts
  const session = await getServerSession(authOptions);
  if (!session?.orgId || !canManageTeam(session.role)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  ```
- `proxy.ts` walls ALL matched routes; unauth `/api/*` → 401. Allowlist const is `OPEN_API_PREFIXES` (line ~41). Routes on that list self-authenticate internally. Matcher is an explicit array — **new pages must be added to it** or they're unauthenticated.
- Supabase: service-role only via `supabaseServer()` from `lib/supabase.ts`. RLS is inert by design — all scoping lives in route handlers.
- Migrations: `supabase/migrations/NNN_name.sql`, highest is `020_rls_leads_messages.sql` → **this build creates `021_pulse.sql`**.
- AI: `ask()` / `askStructured<T>()` in `lib/claude.ts` (model `claude-sonnet-4-6`). Fire-and-forget internal calls use `Authorization: Bearer CRON_SECRET` verified by `hasInternalSecret(req)` from `lib/internal-auth.ts` (see `lib/research-trigger.ts` for the caller pattern — it already solved the base-URL fallback).
- UI: hand-rolled components (NOT shadcn). Dark-locked. Tokens = CSS vars in `app/globals.css` (`--pink: #FF3A69`, `--surface-1..4`, `--border`, `--t1..t4`, `--danger`, `--warning`, `--success`). Toasts = `useToast()` from `components/ui/toast.tsx` (NOT sonner). Icons = `lucide-react`. Nav items = `NAV_LINKS` array in `components/Nav.tsx` (`{ href, label, icon }`) — currently NO role-gating in Nav; the client-side gate pattern to copy is `canManageTeam(session?.role)` via `useSession()` (see `components/OwnerControl.tsx:42`; client hide is cosmetic, server 401/403 is the real guard).
- There is **zero** existing Slack/WhatsApp/notifications-table/Realtime code. Frontend does polling, not Realtime.
- Single-org deployment: resolve `org_id` at ingest via `orgs` table `select … limit 1` (memoize per invocation).
- `vercel.json`: has `functions` maxDurations + ONE cron (`/api/ai/research-drain?limit=15` daily 06:00). This build only ADDS one `functions` entry (classify) — **no cron changes**.

## NEW ENV VARS

Server (`.env.local.example` with comments + real values in Vercel and `.env.local`):
```
# --- Pulse (Felipe-only account watchdog; read-only, server never holds Slack/WA creds) ---
PULSE_BRIDGE_SECRET=         # long random string (openssl rand -hex 32); shared with workers/pulse-bridge/.env
```
Worker only (`workers/pulse-bridge/.env` — NEVER committed, NEVER set in Vercel):
```
FANMAS_URL=https://fanmas.vercel.app
PULSE_BRIDGE_SECRET=         # same value as server
SLACK_USER_TOKEN=            # xoxp-… Felipe's User OAuth Token (read-only scopes)
```

---

## PHASE 1 — Schema: `supabase/migrations/021_pulse.sql`

```sql
-- Pulse: Felipe-only client-conversation watchdog (Slack + WhatsApp), strictly read-only
create table am_conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id),
  channel text not null check (channel in ('slack','whatsapp')),
  external_id text not null,            -- slack channel id (C…/D…/G…) or WA jid (…@s.whatsapp.net)
  display_name text,                    -- slack channel name / WA push name
  client_name text,                     -- Felipe's own label, set in UI
  tracked boolean not null default false,
  muted boolean not null default false,
  snoozed_until timestamptz,
  checkin_days int not null default 14,
  client_notes text,                    -- Felipe's context ("medspa Austin, monthly retainer, waiting on ad creatives") — fed to the classifier
  last_msg_at timestamptz,
  last_direction text check (last_direction in ('in','out')),
  last_msg_preview text,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  handled_at timestamptz,               -- "Mark handled": suppresses owe-reply until the NEXT inbound
  ai_needs_reply boolean,
  ai_waiting_on text check (ai_waiting_on in ('you','them','none')),  -- who the ball is with, per the classifier
  ai_open_commitment text,              -- what Felipe promised and hasn't delivered (null if none)
  ai_summary text,
  ai_suggested_reply text,
  ai_classified_msg_id text,            -- external_id of the message the ai_* fields describe (cache key)
  meta jsonb not null default '{}',     -- {team_id} for slack, {phone} for wa
  created_at timestamptz not null default now(),
  unique (org_id, channel, external_id)
);

create table am_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references am_conversations(id) on delete cascade,
  external_id text not null,            -- slack msg ts / WA message key id (idempotency)
  direction text not null check (direction in ('in','out')),
  author text,
  body text,
  sent_at timestamptz not null,
  raw jsonb,
  created_at timestamptz not null default now(),
  unique (conversation_id, external_id)
);
create index am_messages_convo_sent on am_messages (conversation_id, sent_at desc);

-- Feed liveness: worker heartbeats per source; a stale row = show the "feed offline" banner
create table am_sources (
  channel text primary key check (channel in ('slack','whatsapp')),
  last_heartbeat_at timestamptz,
  detail jsonb not null default '{}'    -- e.g. {channels_polled: 42} / {wa_connected: true}
);

-- Same posture as 020: RLS on, anon revoked, service-role only.
alter table am_conversations enable row level security;
alter table am_messages enable row level security;
alter table am_sources enable row level security;
revoke all on am_conversations, am_messages, am_sources from anon, authenticated;
```

Mirror migration 020's exact revoke/grant style (open it and copy the idiom). Apply to prod via the Supabase Management API method already used for 016–020 (project ref `tiymeobqgmviwruvlbnm`, `POST /v1/projects/{ref}/database/query`, must send a User-Agent header) — or print the SQL and pause for Felipe if no `sbp_` token is available.

## PHASE 2 — Core lib: `lib/am/status.ts`, `lib/am/ingest.ts`, `lib/prompts/pulse.ts`

**`lib/am/status.ts`** — pure function, no IO:

```ts
export type PulseStatus = "red" | "amber" | "green" | "hidden";
export type PulseReason = "owe_reply" | "commitment" | "nudge" | "checkin" | "fresh_inbound" | "ok" | "snoozed" | "muted" | "untracked";

const OWE_AMBER_HOURS = 4;
const OWE_RED_HOURS = 24;
const OWE_RED_HOURS_SEEN = 12;   // he already opened it — escalate faster
const NUDGE_DAYS = 3;
const QUIET_START_ET = 23, QUIET_END_ET = 7; // red clamp window

export function computeStatus(c: AmConversationRow, now = new Date()): { status: PulseStatus; reason: PulseReason; hoursSinceInbound: number | null; seen: boolean }
```

`seen` = `c.meta.last_read_at` exists AND `>= last_inbound_at` (Slack read cursor — Felipe opened the thread after the client's last message; always false for WhatsApp v1). In the owe path, red threshold = `seen ? OWE_RED_HOURS_SEEN : OWE_RED_HOURS`.

Rules, in priority order: muted → hidden/muted; snoozed_until > now → hidden/snoozed; not tracked → hidden/untracked; last_direction='in' AND (handled_at is null OR handled_at < last_inbound_at) AND ai_needs_reply !== false → owe path (≥24h red — clamped out of 11pm–7am ET, fires at 7am; ≥4h amber; else green/fresh_inbound); **last_direction='out' AND ai_waiting_on='you' AND (handled_at is null OR handled_at < last_msg_at) → amber/commitment** (the sneak case: he replied "will do!" but still owes the deliverable — card shows `ai_open_commitment`); last_direction='out' AND hours since last_msg_at ≥ 72 → amber/nudge; last_msg_at older than checkin_days → amber/checkin; else green/ok. Use `Intl.DateTimeFormat("en-US", { timeZone: "America/New_York", hour: "numeric", hour12: false })` for the ET clamp — no date libs.

**`lib/am/ingest.ts`** — the single ingest path:

```ts
export interface IngestMsg { channel: "slack" | "whatsapp"; externalConvoId: string; externalMsgId: string;
  direction: "in" | "out"; author?: string; body: string; sentAt: string /* ISO */; displayName?: string; meta?: Record<string, unknown>; raw?: unknown }
export async function ingestMessages(msgs: IngestMsg[]): Promise<{ ingested: number; duplicates: number }>
```

Per message: resolve org (memoized `orgs` limit-1 select) → upsert `am_conversations` on `(org_id, channel, external_id)` (set display_name/meta only if currently null) → insert `am_messages` (swallow unique-violation = duplicate poll overlap, count it, skip denorm update) → update conversation denorms (`last_msg_at` only if newer, `last_direction` from the newest message, `last_msg_preview` truncated 140, `last_inbound_at`/`last_outbound_at`). If newest message is direction='in' AND conversation tracked → fire-and-forget `POST {base}/api/am/internal/classify` with `Authorization: Bearer CRON_SECRET` (copy `lib/research-trigger.ts` verbatim for base URL + header).

**`lib/prompts/pulse.ts`** — system + user prompt builders for classification. Input: last **25** messages (author/direction/body/ago) + `client_name` + `client_notes` (the notes are load-bearing for accuracy — say so in a comment). Output schema for `askStructured`:
`{ needs_reply: boolean, waiting_on: "you"|"them"|"none", open_commitment: string|null, urgency: "low"|"medium"|"high", summary: string (≤120 chars, plain), suggested_reply: string }`.
Classifier rules to encode in the system prompt: this is CLIENT account management — judge like a top CSM. `needs_reply=false` ONLY for clear closers ("thanks!", "sounds good", "🙏") with nothing pending; **when uncertain, `needs_reply=true`** (a false fire costs a glance; a missed one costs a client). `waiting_on="you"` whenever Felipe made a promise/commitment not yet visibly delivered in the thread — quote it in `open_commitment`. Determinism: extend `askStructured` with an optional `temperature` param (default = current behavior, non-breaking) and call it with `temperature: 0`.
Voice for suggested_reply: Felipe's casual professional tone, 1–3 sentences, no em dashes, no corporate filler, ends with a concrete next step or question when appropriate. (It is copy-paste material only — nothing sends it.)

## PHASE 3 — API routes

**Ingest (open at the wall, self-authenticating):**

- `app/api/pulse/events/route.ts` — POST `{ messages?: IngestMsg[], heartbeats?: { channel: "slack"|"whatsapp", detail?: object }[], convoUpdates?: { channel: "slack"|"whatsapp", externalConvoId: string, lastReadAt: string }[] }`. Auth: `Authorization: Bearer ${PULSE_BRIDGE_SECRET}` (timing-safe compare; 503 with clear JSON if env unset) → else 401. Zod-validate (zod v4 installed), cap batch at 200, call `ingestMessages`, upsert `am_sources.last_heartbeat_at = now()` for each heartbeat, and for each convoUpdate merge `meta.last_read_at` onto the matching conversation (skip silently if it doesn't exist yet). Return counts.

**Internal (open at the wall, CRON_SECRET-gated via `hasInternalSecret`):**

- `app/api/am/internal/classify/route.ts` — POST `{ conversationId }`. Load conversation + last 10 `am_messages`; skip (200 no-op) if latest external_id === `ai_classified_msg_id`; `askStructured` with the pulse schema; write `ai_*` fields + `ai_classified_msg_id`. `maxDuration` 60.

**Felipe-only UI routes (NOT in OPEN_API_PREFIXES — wall enforces session, handler enforces admin).** Use the exact `app/api/team/route.ts` gate idiom quoted above:

- `app/api/am/conversations/route.ts` — GET `?view=board|untracked|counts`. Board = tracked & !muted with computed `{ status, reason, hoursSinceInbound, seen }` merged in, plus `link` built server-side (slack: `https://app.slack.com/client/${meta.team_id}/${external_id}`; whatsapp: `https://wa.me/${external_id.split("@")[0]}`), plus `counts: { red, amber, green, untracked }`, plus `sources: { slack: { lastHeartbeatAt, stale }, whatsapp: {...} }` (stale = heartbeat older than 10 min or missing). Untracked = `tracked=false & !muted`, newest first. `counts` view = counts only (cheap, for the nav badge). Sort board: red (oldest inbound first) → amber → green.
- `app/api/am/conversations/[id]/route.ts` — PATCH body (zod): `{ tracked?, muted?, client_name?, client_notes?, checkin_days?, snooze_days?: 1|3|7|null, handled?: true }`. `handled:true` → `handled_at = now()`; `snooze_days:null` clears snooze. GET → conversation + last 20 messages (detail drawer).

## PHASE 4 — `proxy.ts` (surgical — two arrays only)

1. Append to `OPEN_API_PREFIXES`: `"/api/pulse"`, `"/api/am/internal"`. (`/api/am` itself deliberately ABSENT — `/api/am/conversations` stays behind the session wall. Prefix matching is exact-or-`startsWith(p + "/")`, so `/api/am/internal` does not open `/api/am/conversations`.)
2. Append to `config.matcher`: `"/accounts/:path*"`.

## PHASE 5 — `vercel.json`

One addition to `functions`: `"app/api/am/internal/classify/route.ts": { "maxDuration": 60 }`. **Do not touch `crons`.**

## PHASE 6 — UI: `/accounts` page + Nav

**`components/Nav.tsx`:** add `{ href: "/accounts", label: "Accounts", icon: Radar }` (lucide `Radar`) — rendered ONLY when `canManageTeam(session?.role)` (Nav gets `useSession()` for the first time; filter `NAV_LINKS` before the existing `.map`). Badge on this item = `red` count from `GET /api/am/conversations?view=counts`, polled on the same 60s interval Nav already runs (piggyback the existing `loadCounts` interval, don't add a second timer). Reps: no nav item, and the API 401s them anyway.

**`app/accounts/page.tsx`** (thin server wrapper) + **`components/pulse/PulseBoard.tsx`** (client):
- `useSession()`; if `!canManageTeam(session?.role)` render null (cosmetic — server 401s anyway).
- Fetch `?view=board` + `?view=untracked`, poll every 60s.
- **Feed-health banner (top of page, non-dismissable):** if `sources.slack.stale` or `sources.whatsapp.stale` → red banner "⚠️ {Slack|WhatsApp} feed offline since {time} — statuses below may be stale" with a hint ("check pulse-bridge on your Mac: `pm2 status`"). Accuracy rule: never let a dead feed masquerade as all-green.
- Sections top-to-bottom: **🔥 Fires** (red) / **🟠 Next actions** (amber, reason chip says which: reply soon · you promised · nudge · check-in) / **➕ New — track as client?** (untracked: "Track" → PATCH tracked:true, "Ignore" → PATCH muted:true) / **🟢 All good** (collapsed `<details>`).
- **`components/pulse/PulseCard.tsx`**: channel glyph (lucide `Hash` for slack channels, `MessageCircle` for WA/DMs), `client_name ?? display_name`, reason chip + age ("owes reply · 26h"; when `seen`, a distinct **"👀 seen · no reply"** badge in `var(--danger)` — this is the headline state, make it impossible to miss; commitment cards show `ai_open_commitment` verbatim: "you promised: send the report"), `last_msg_preview`, AI summary line, suggested reply in a quiet box with **Copy** (`useToast().success("Copied — paste it yourself")`), buttons: **Open** (deep `link`, `target="_blank"`), **Handled** (PATCH `handled:true`), **Snooze 1d/3d**, **Mute**. Inline rename → `client_name`. Expandable detail drawer (GET `[id]`): last 20 messages + a **Notes** textarea (PATCH `client_notes`, helper text: "context here makes the AI sharper"). NO send button of any kind.
- Styling: existing tokens — `var(--surface-2)` cards, `var(--border)`, status left-borders `var(--danger)/var(--warning)/var(--success)` (mirror `LeadCard.tsx`'s left-border urgency approach), text scale `--t1..t4`. Dark only. No new deps.

## PHASE 7 — The bridge: `workers/pulse-bridge/` (Slack poller + WhatsApp listener, one process)

Standalone Node worker (NOT part of the Next build — new top-level dir, own `package.json`; add `workers/pulse-bridge/auth/`, `workers/pulse-bridge/state.json`, `workers/pulse-bridge/.env` to root `.gitignore`).

- `package.json`: `{ "type": "module" }`, deps: `baileys` (check npm — formerly `@whiskeysockets/baileys`), `qrcode-terminal`, `dotenv`. Script `start: node index.mjs`.
- `index.mjs` — boots both loops, shared batcher:
  - **Batcher:** buffer normalized `IngestMsg`s; flush every 5s or 20 msgs → `POST ${FANMAS_URL}/api/pulse/events` with `Authorization: Bearer ${PULSE_BRIDGE_SECRET}`; on non-200/network error keep buffered, retry with backoff, cap 1000. **Heartbeats:** every 60s each loop enqueues `{ channel, detail }` (WA: `{wa_connected}`; Slack: `{channels_polled}`) — sent even when there are no messages, so the server can tell "quiet" from "dead".
  - **WhatsApp loop (`wa.mjs`):** `useMultiFileAuthState("./auth")` → `makeWASocket({ auth: state })`; print QR on `connection.update` via qrcode-terminal; save on `creds.update`; reconnect on close unless `DisconnectReason.loggedOut` (print "delete ./auth and re-scan"). `messages.upsert` — handle BOTH type `notify` (live) AND type `append` (offline catch-up after the worker was down; the server's unique constraint makes re-delivery harmless): only 1:1 chats (`remoteJid.endsWith("@s.whatsapp.net")`) — skip groups/status/protocol/reactions. Text: `message.conversation ?? message.extendedTextMessage?.text ?? caption ?? "[media]"`. Map → `{ channel:"whatsapp", externalConvoId: remoteJid, externalMsgId: key.id, direction: key.fromMe ? "out" : "in", author: pushName, body, sentAt, displayName: pushName, meta: { phone: remoteJid.split("@")[0] } }`. **Read-only invariant: never import/call any send/presence API.** Baileys' API drifts — after `npm i`, verify event names/shapes against the installed version's types.
  - **Slack loop (`slack.mjs`):** plain `fetch` against `https://slack.com/api/*` with `SLACK_USER_TOKEN` — no Slack SDK. On boot: `auth.test` → `{ user_id, team_id }` (direction: `msg.user === user_id ? "out" : "in"`; team_id → meta for deep links). Every **5 min**: `users.conversations` (types `public_channel,private_channel,im,mpim`, `exclude_archived=true`, paginate) → for each conversation, `conversations.history` with `oldest` = stored cursor (per-channel cursors + a floor of "now minus 7 days" on first run, persisted in `./state.json` — this makes Slack self-healing: if the worker is down for a day, the next poll backfills the entire gap from the cursors). **Threads:** for any parent in the fetched window whose `latest_reply` > cursor, also pull `conversations.replies`. Skip messages with `subtype` or `bot_id`. Map → `{ channel:"slack", externalConvoId: channel_id, externalMsgId: ts, direction, author: user_id-resolved-name (cache `users.info` lookups in state.json), body: text, sentAt: new Date(Number(ts)*1000), displayName: channel name from users.conversations, meta: { team_id } }`. **Read cursor ("seen" detection):** for channels whose newest known message is inbound, also call `conversations.info` → the member `last_read` ts; when it changed vs state.json, enqueue a `convoUpdate` `{ externalConvoId, lastReadAt: new Date(Number(last_read)*1000).toISOString() }` (counts toward the same ≤40/min throttle). **Rate limits:** `conversations.history` is Tier 3 (~50 req/min) — throttle to ≤40/min with a simple queue; at ~100 channels/5 min that's comfortable. If token missing → log once, skip loop (WA still runs).
  - `.env.example`: `FANMAS_URL=`, `PULSE_BRIDGE_SECRET=`, `SLACK_USER_TOKEN=`.
- `README.md`: run `npm start` (scan WA QR once), keep alive via `pm2 start index.mjs --name pulse-bridge` or the included launchd plist (`com.felipe.pulse-bridge.plist`, KeepAlive, load instructions).

## 🧍 FELIPE-ONLY SETUP (agent: print this checklist and pause when code is done)

1. **Slack user token (your persona, read-only).** api.slack.com/apps → Create New App → From manifest → paste (note: NO bot user, NO events, NO write scopes — this "app" is just the OAuth client that mints YOUR token; nothing appears in any channel):
   ```json
   { "display_information": { "name": "Pulse (Felipe personal, read-only)" },
     "oauth_config": { "scopes": { "user": [
       "channels:history","channels:read","groups:history","groups:read",
       "im:history","im:read","mpim:history","mpim:read","users:read","users:read.email"
     ] } },
     "settings": { "org_deploy_enabled": false, "socket_mode_enabled": false } }
   ```
   Create it **in the Commas (FanBasis) workspace** → Install to Workspace (this authorizes only YOU) → copy the **User OAuth Token (xoxp-…)** into `workers/pulse-bridge/.env`. Slack Connect client channels are covered automatically — the poller sees whatever YOU can see. If the workspace requires admin approval for apps, request it (it's invisible + read-only; you're the owner anyway) — or tell Claude to build Plan B (browser session token).
2. `openssl rand -hex 32` → set as `PULSE_BRIDGE_SECRET` in Vercel env AND `workers/pulse-bridge/.env`; redeploy.
3. In `workers/pulse-bridge`: `npm i && npm start` → scan the QR with WhatsApp → Linked Devices. Then pm2/launchd it.
4. Open `/accounts` — untracked threads appear as the poller sweeps; click **Track** on real clients, **Ignore** on noise (internal channels, family WA chats).

## VERIFICATION (agent must run all before writing handoff)

1. `npm run build` clean; `npx tsc --noEmit` clean.
2. Migration applied (or SQL printed + pause). Confirm both unique constraints exist.
3. Wall checks (`curl`, local dev): unauthenticated `GET /api/am/conversations` → **401** (wall); `POST /api/pulse/events` with wrong Bearer → **401**; correct Bearer + 2-message fixture → **200 ingested:2**; re-POST same batch → **duplicates:2**, no new rows.
4. **Golden accuracy set** (fixture script that seeds conversations then asserts `computeStatus` + classifier output — this is the heart of "extremely accurate", don't skimp):
   - Client asked a question 5h ago, no reply → **amber/owe_reply**; 30h → **red** (and NOT red if "now" is 2am ET — clamp fires at 7am).
   - Same message but `meta.last_read_at` after it (Felipe OPENED it) → `seen:true`, red already at **14h** (12h threshold); without last_read → red only at 24h.
   - Client's last message is "thanks so much! 🙏" → classifier `needs_reply=false` → **green** (no false fire on closers).
   - Felipe's last message: "will do, sending the report tomorrow" + 2 days silence → classifier `waiting_on="you"`, `open_commitment` quotes the promise → **amber/commitment** (the sneak case MUST fire).
   - Felipe asked client a question, 4 days silence → **amber/nudge**; quiet tracked client at 15 days (checkin_days 14) → **amber/checkin**.
   - Untracked internal channel with unanswered inbound → **hidden** (never on the board); handled_at after last inbound → **green**; snoozed → hidden until expiry.
   - Ambiguous inbound ("hmm ok let me think") → classifier returns `needs_reply=true` (uncertain → flag bias).
5. Heartbeats: POST heartbeat-only batch → `am_sources` row updated; set a row's `last_heartbeat_at` 20 min back → board GET reports `stale:true` and the UI shows the offline banner.
6. `GET /api/am/conversations?view=board` as Felipe's session → statuses + deep links + `sources` present; as a rep session → **401**.
7. UI: `/accounts` renders banner + all four sections; Copy/Handled/Snooze/Mute/Notes round-trip and toast; rep account sees no nav item and API bounces it.
8. **Read-only audit:** `grep -rn "chat.postMessage\|sendMessage\|chat_write\|chat:write" app/ lib/ workers/` → **zero hits**. Slack manifest in this file contains no write scope. Worker imports no send helpers.
9. `node --check` both worker files; worker runs against a mock endpoint without crashing; Slack loop throttles (log requests/min in a dry run).

Do NOT commit: `workers/pulse-bridge/auth/`, `state.json`, any `.env*` with real values. When done, write `HANDOFF_PULSE.md` (what shipped, deviations, Felipe-only steps remaining).

## OUT OF SCOPE (v1 — do not build)

Any message sending (permanent, not just v1), digests/notifications outside the dashboard, the Servedia workspace (this build is Commas account management only — Servedia could be a later second token), WhatsApp read-receipt/"seen" detection (Slack-only v1), WA group chats, media rendering, per-client SLA overrides beyond `checkin_days`, Realtime (polling is fine), reps ever seeing this section.
