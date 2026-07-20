# HANDOFF — Pulse (Accounts watchdog) · built 2026-07-20

Full implementation of `PULSE_BUILD.md`, single session. Admin-only `/accounts` section watching Commas client conversations on Slack (Felipe's persona, read-only user token) + WhatsApp (Baileys bridge). **Never sends anything, anywhere — verified by grep audit.**

## What shipped

- **Migration `021_pulse.sql` — APPLIED TO PROD** (Management API, verified: 3 tables + unique constraints live). `am_conversations`, `am_messages`, `am_sources` (heartbeats), RLS+FORCE+revoke posture mirroring 020.
- **`lib/am/status.ts`** — pure derive-at-read engine. Thresholds: 4h amber / 24h red (12h red when SEEN via Slack read cursor), quiet-clamp 11pm–7am ET (h23 hourCycle), commitment (`ai_waiting_on='you'`), 3d nudge, `checkin_days` check-in. Handled = suppress-until-next-message; handled counts as a touch for check-in.
- **`lib/am/ingest.ts`** — grouped upsert path, per-row insert with 23505 dedupe, forward-only denorms, fire-and-forget classify (CRON_SECRET, research-trigger pattern) for tracked+inbound only. `applyConvoUpdates` merges `meta.last_read_at`; `recordHeartbeats` upserts `am_sources`.
- **`lib/prompts/pulse.ts`** + **`lib/claude.ts`**: classifier (25 msgs + client_notes, uncertain→flag bias, waiting_on/open_commitment) run at temperature 0 via a new optional `temperature` param on `askStructured` (non-breaking, appended arg).
- **Routes:** `POST /api/pulse/events` (Bearer PULSE_BRIDGE_SECRET, timing-safe, 503 when unset; zod-validated messages/heartbeats/convoUpdates) · `POST /api/am/internal/classify` (hasInternalSecret; skips untracked + already-classified; model failure leaves ai_* untouched so raw-timestamp fires still work) · `GET /api/am/conversations?view=board|untracked|counts` + `GET/PATCH /api/am/conversations/[id]` (session + canManageTeam, org-scoped, NOT in OPEN_API_PREFIXES).
- **proxy.ts:** `+/api/pulse`, `+/api/am/internal` in OPEN_API_PREFIXES (with comment); `+/accounts/:path*` in matcher. **vercel.json:** classify maxDuration 60, crons untouched.
- **UI:** `app/accounts/page.tsx`, `components/pulse/PulseBoard.tsx` (🔥 Fires / 🟠 Next actions / ➕ untracked triage / 🟢 collapsed; red feed-offline banner only for feeds that heartbeated then died; never-connected feeds get a setup hint instead), `PulseCard.tsx` (👀 seen·no-reply badge, commitment quote, copy-only suggested reply, Open deep link, Handled/1d/3d/Mute, detail drawer w/ client name+notes+last 20 msgs). **Nav:** first role-gated item (Radar icon, admin-only) + fires-count badge piggybacking the existing 60s poll.
- **`workers/pulse-bridge/`** (Mac-side, own package.json, deps installed): `batcher.mjs` (5s/20-msg flush, backoff, 1000-cap), `wa.mjs` (Baileys, notify+append upserts, 1:1 only, envelope unwrap, QR via qrcode-terminal, reconnect-unless-logged-out), `slack.mjs` (user-token poller: users.conversations → history w/ 7d-floor cursors → replies for active threads → conversations.info last_read for seen-detection; 1.5s call gap ≈ 40/min; 429 retry-after honored; state.json persistence), README + launchd plist. `.env` pre-filled with FANMAS_URL + the generated secret.

## Verification results (all green)

- `npx tsc --noEmit` clean · `npm run build` clean (all 5 new routes present) · eslint clean on all new/edited files · `node --check` all 4 worker files · worker `npm install` OK (baileys ^6.7.0 resolves).
- **Golden set 15/15** (`scripts/pulse-golden.ts`, run via `npx tsx`): amber@5h, red@30h, quiet-clamp@2amET, seen→red@14h vs unseen→amber@14h, closer→green, commitment fires, nudge@4d, checkin@15d, untracked hidden, handled suppress + handled-before-newer-inbound still fires, snoozed hidden, unclassified-still-fires, fresh-inbound green.
- **Live curl vs dev server:** unauth `/api/am/conversations` → 401 · unauth `/accounts` → 307 /login · wrong bearer events → 401 · fixture batch → ingested:2 · re-post → duplicates:2 · malformed → 400 · convoUpdate → merged (verified in DB: `meta.last_read_at` landed) · classify wrong secret → 401. Fixture rows + test heartbeat deleted from prod after verification.
- **Read-only grep audit:** zero send-API calls in app/lib/components/worker (only the comment in slack.mjs stating the invariant).

## Deviations from PULSE_BUILD.md (all minor)

1. Board sorting/dedup exactly as specced, but `view=counts` computes statuses server-side (needed for red count) — still cheap, single indexed query.
2. Feed banner: added a "never connected yet" state (setup hint, not red alarm) so first-run isn't a permanent false alarm — spec only defined the stale case.
3. PulseBoard uses a tick-state reload (eslint react-hooks/set-state-in-effect forbade the specced load-in-useCallback shape).
4. `.env.local.example` is itself gitignored in this repo (`.env*`) — the Pulse block was appended locally but won't ship in the commit.
5. Worker deps: dotenv ^16 (not ^17); golden tests run via `npx tsx` (not a package.json script).

## 🧍 FELIPE — remaining steps (in order)

1. **Vercel env:** add `PULSE_BRIDGE_SECRET` = the value in `.env.local` (Project → Settings → Environment Variables) → redeploy. Until then the deployed events route 503s (fail-closed, by design).
2. **Slack token:** api.slack.com/apps → Create from manifest (JSON in `workers/pulse-bridge/README.md`) **in the Commas workspace** → Install → copy the **xoxp User OAuth Token** into `workers/pulse-bridge/.env` (`SLACK_USER_TOKEN=`). No bot, no write scopes, invisible in channels.
3. **Start the bridge:** `cd workers/pulse-bridge && npm start` → scan QR with WhatsApp → Linked Devices. Then `pm2 start index.mjs --name pulse-bridge && pm2 save && pm2 startup` (or the launchd plist).
4. Open `/accounts` → Track real clients from the untracked pile, Ignore noise, add client notes (feeds the AI).
5. Not done/not needed: ANTHROPIC_API_KEY exists in Vercel (research pipeline uses it) so classification works in prod; nothing else to set.
