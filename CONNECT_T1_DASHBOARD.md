# CONNECT · Terminal 1 — DASHBOARD / SERVER (unified-sales-ops)

**Goal of the wave:** cut extension setup from ~15 steps to **one Google sign-in**. You own the server half: the rep token, the bootstrap + calendar endpoints, and moving Google Calendar server-side. Terminal 2 owns the extension and consumes your endpoints. You never touch `chrome-extension/**`; T2 never touches `app/**` or `lib/**`.

Working dir: `/Users/felipe/unified-sales-ops`

> ⚠️ Read `node_modules/next/dist/docs/` before writing route code — this Next.js has breaking changes vs. what you know (see AGENTS.md).

---

## Adopted defaults (decided 2026-07-02 — flag Felipe only if you hit a wall)
- **Option A** — build slim + self-contained here. Name new tables like Stackit's (`user_integrations`) so a later convergence is a migration, not a rewrite.
- **Bookings → the rep's personal Google Calendar (`primary`)**, same as today. A shared FanBasis calendar is a future one-line calendar-id swap — leave a `// TODO shared-cal` marker.
- **Sign-in** = in-panel button in the extension → `chrome.identity.launchWebAuthFlow` → your `/api/extension/auth/start`.

---

## FROZEN CONTRACTS (identical block in both files — do not change unilaterally)

**C1 — Auth handoff (you mint, T2 consumes).**
`GET /api/extension/auth/start?ext_redirect=<url>` :
- Validate `ext_redirect` ends with `.chromiumapp.org/` (reject otherwise).
- Read NextAuth session (`getServerSession`). If none → redirect into Google sign-in with `callbackUrl` back to this route (preserving `ext_redirect`).
- Once signed in → mint **repToken** and `302` to `` `${ext_redirect}#token=${repToken}` ``.
- **repToken** = signed JWT `{ sub: rep_id, email, name, team_id, ver, iss:"fbsalesops", exp: +90d }`, HS256 with `process.env.EXTENSION_TOKEN_SECRET`.

**C2 — Bootstrap.** `GET /api/extension/bootstrap`, header `Authorization: Bearer <repToken>` →
```json
{ "ok": true,
  "dashboardUrl": "https://unified-sales-ops.vercel.app",
  "fanbasisHandle": "fanbasis",
  "rep": { "id": "...", "email": "...", "name": "...", "personalIgUsername": "..." },
  "calendar": { "connected": true, "slotMins": 30, "timezone": "America/New_York" } }
```
`401 {ok:false}` if token missing/invalid/expired.

**C3 — Calendar (Bearer repToken on both).**
- `GET /api/calendar/slots?days=7&slotMins=30` → `{ ok:true, slots:[{start:ISO,end:ISO}] }`
- `POST /api/calendar/book` `{ slotStart, slotEnd, leadName, guestEmail? }` → `{ ok:true, eventId, htmlLink }`
- If the rep's Google grant lacks calendar scope → `{ ok:false, needsCalendar:true }` (T2 prompts a re-sign-in to upgrade scope). `401` if token bad.

**C4 — ig-events identity.** `POST /api/ig-events` accepts `Authorization: Bearer <repToken>` (preferred); resolve `rep_id` and stamp it on created/updated leads + events. **Keep `x-ig-secret` working** as fallback (rep_id null) so nothing breaks mid-rollout.

---

## Tasks

### Task 1 — rep-token lib (`lib/extension-token.ts`, NEW)
`mintRepToken(rep)` and `verifyRepToken(authHeader) → {rep_id,email,name,team_id} | null`. HS256, `EXTENSION_TOKEN_SECRET`. Include a `ver` claim compared against the user's `extension_token_version` (Task 5) so tokens are revocable. Add `EXTENSION_TOKEN_SECRET` to `.env.local` + Vercel + `.env.local.example`.

### Task 2 — persist the rep's Google tokens (`lib/auth.ts` + migration)
Calendar routes are called with a repToken, **not** a NextAuth cookie — so they can't read `session.access_token`. You must persist the rep's Google **refresh_token** server-side, keyed by rep_id, and refresh independently (this is exactly Stackit's model).
- `lib/auth.ts:60` — add calendar scopes to the Google `scope` string: append `https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly`. Confirm `access_type:"offline"` (`:61`) and add `prompt:"consent"` so a refresh_token is actually returned.
- In the `signIn`/`jwt` callback where `account.access_token` is captured (`~:100`), **upsert** `{ user_id, refresh_token, access_token, expires_at, scopes }` into `user_integrations` (type `"google"`).
- Reuse the existing `refreshAccessToken()` (`lib/auth.ts:27`) for the server-side refresh path.

### Task 3 — `/api/extension/auth/start/route.ts` (NEW) — implements C1
Session check → sign-in redirect → mint → redirect to `ext_redirect#token=`. Validate the redirect host allowlist.

### Task 4 — bootstrap + calendar routes (NEW) — implement C2 + C3
- `/api/extension/bootstrap/route.ts`: verifyRepToken → return the C2 shape. `calendar.connected` = does `user_integrations(type=google)` have a refresh_token with calendar scope?
- `/api/calendar/slots/route.ts`: verifyRepToken → load rep's Google token → refresh if needed → Google `freeBusy` → compute open slots. **Port the slot logic** currently in `chrome-extension/ig-lead-tracker/background.js:67-104` (business hours 9–6, no weekends) so behavior matches. Return `{needsCalendar:true}` if no calendar scope.
- `/api/calendar/book/route.ts`: verifyRepToken → create event on `primary` (`// TODO shared-cal`), mirror today's payload from `background.js:492-521` (title `FanBasis Discovery: {leadName} × {rep}`, tentative, optional guest). Return `eventId`/`htmlLink`.

### Task 5 — migration `014` + ig-events identity (`app/api/ig-events/route.ts`)
- New migration `supabase/migrations/014_extension_identity.sql`: create `user_integrations` (mirror Stackit: `id, team_id, user_id, integration_type, config jsonb, is_connected, connected_at, timestamps, UNIQUE(team_id,user_id,integration_type)`, RLS: users CRUD own, service_role all); add `personal_ig_username text` + `extension_token_version int default 1` to the users table; add `rep_id uuid` (nullable) to leads + messages for stamping.
- `app/api/ig-events/route.ts:20-22`: before the `x-ig-secret` check, try `verifyRepToken(Authorization)`. If valid → set `rep_id` on all writes (`:72`, `:89` region). If only the secret is present → today's behavior, `rep_id` null.

---

## Test checklist (T1 in isolation — curl, no extension needed)
- [ ] `curl` bootstrap with a hand-minted repToken → correct C2 JSON; bad token → 401.
- [ ] `/api/calendar/slots` with a rep who granted calendar scope → slots; rep without → `{needsCalendar:true}`.
- [ ] `/api/calendar/book` creates a real event on the rep's calendar; returns eventId.
- [ ] `/api/extension/auth/start?ext_redirect=https://x.chromiumapp.org/` while logged in → 302 to `...#token=`; bad redirect host → rejected.
- [ ] ig-events with Bearer repToken stamps `rep_id`; with `x-ig-secret` still works (rep_id null).
- [ ] `npm run build` passes.

## Done when
A rep token issued by `/auth/start` unlocks bootstrap + calendar + identity-stamped ig-events, with the rep's Google tokens persisted and refreshed server-side. Google sign-in now requests calendar scope. Migration `014` written. Commit + push (auto-deploys to Vercel). **Coordinate the `014` apply with Felipe** (SQL editor — same as `013`).
