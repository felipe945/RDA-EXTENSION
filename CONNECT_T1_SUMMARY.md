# CONNECT · Terminal 1 — SUMMARY (dashboard/server) ✅ SHIPPED

**Commit `0d0ad9f`** on main, pushed 2026-07-02 (auto-deploys to Vercel). Lands on top of T2's `2ea8e30` (extension v2.2.0), so the full one-Google-sign-in wave is on main.

**Goal:** cut extension setup from ~15 steps to one Google sign-in. T1 owned the server half: rep token, bootstrap + calendar endpoints, Google Calendar moved server-side.

---

## ⚠️ ONE BLOCKER — Felipe applies migration 014

Run `supabase/migrations/014_extension_identity.sql` in the **Supabase SQL editor** (same routine as 013). Until then, the deployed code is safe but degraded:

| Pre-014 behavior | Post-014 |
|---|---|
| `calendar.connected` always `false`, slots/book return `needsCalendar:true` | Real slots + bookings once a rep re-signs-in |
| `rep_id` not stamped (writes safely omit the column — nothing 500s) | Leads + ig_events entries stamped with the rep |
| Token revocation `ver` check defaults to 1 | Bump `users.extension_token_version` to kill a rep's tokens |

Then: **each rep signs into Google once more** (consent screen now asks for calendar scope → refresh_token lands in `user_integrations`), verify the post-014 items below, and upload extension 2.2.0 to the Web Store.

---

## What was built (frozen contracts C1–C4)

### C1 — Auth handoff
- **`lib/extension-token.ts`** (NEW): `mintRepToken` / `verifyRepToken`. HS256 JWT `{ sub: rep_id, email, name, team_id, ver, iss:"fbsalesops", exp:+90d }`, signed with `EXTENSION_TOKEN_SECRET`. `ver` is checked against `users.extension_token_version` on every verify → revocable. Tolerates the pre-014 window (`select *`, version defaults 1).
- **`app/api/extension/auth/start/route.ts`** (NEW): validates `ext_redirect` is `https://*.chromiumapp.org/` (rejects evil.com, http, path-lookalikes), reuses the NextAuth session (bounces through `/login` preserving `ext_redirect` if absent), mints, 302s to `${ext_redirect}#token=…` (fragment → never in server logs).
- **`app/login/page.tsx`**: now honors a relative-only `callbackUrl` param (open-redirect safe) so the handoff can round-trip through sign-in.

### C2 — Bootstrap
- **`app/api/extension/bootstrap/route.ts`** (NEW): Bearer repToken → `{ ok, dashboardUrl, fanbasisHandle, rep{id,email,name,personalIgUsername}, calendar{connected,slotMins,timezone} }`. 401 `{ok:false}` on bad token. `connected` = google `user_integrations` row has refresh_token + calendar scope.

### C3 — Calendar, server-side
- **`lib/auth.ts`**: Google scope string now appends `calendar.events` + `calendar.readonly` (offline + `prompt:consent` already there). On sign-in, the grant is upserted into `user_integrations` (type `google`, config jsonb: refresh_token/access_token/expires_at/scopes) — never clobbers a stored refresh_token with undefined, never blocks sign-in. `refreshAccessToken()` exported for the cookie-less path.
- **`lib/google-calendar.ts`** (NEW): loads the rep's grant, refreshes + persists independently of NextAuth; `findOpenSlots` is a faithful port of `background.js` slot logic (9:00–18:00, no weekends, 15-min marks, ≥1h out) made **timezone-aware** (Vercel runs UTC; default `America/New_York`, per-rep override via config); freeBusy + event creation against `primary` with `// TODO shared-cal` markers.
- **`app/api/calendar/slots/route.ts`** (NEW): `?days=&slotMins=` → `{ok, slots:[{start,end}]}`; `{needsCalendar:true}` when the grant is missing/scope-less/revoked.
- **`app/api/calendar/book/route.ts`** (NEW): zod-validated `{slotStart, slotEnd, leadName, guestEmail?}` → tentative `FanBasis Discovery: {Lead} X {Rep}` event, mirrors the old extension payload exactly → `{ok, eventId, htmlLink}`.

### C4 — ig-events identity
- **`app/api/ig-events/route.ts`**: Bearer repToken preferred → `rep_id` stamped on lead insert/update **and** inside appended `ig_events` entries. `x-ig-secret` fallback unchanged (rep_id null). Mid-rollout safe: `rep_id` key is omitted entirely when token-less, so legacy extensions can't 500 on the missing column pre-014.

### Infra
- **`proxy.ts`**: `/api/extension` + `/api/calendar` added to the self-authenticating open list (the auth wall was 401-ing them before the route code ever ran; auth/start must also redirect a fresh browser tab to /login, not 401).
- **`supabase/migrations/014_extension_identity.sql`** (NEW): `user_integrations` (Stackit-shaped: same name/columns/unique key; `team_id` → this repo's `orgs`), RLS locked down (tokens live here — service-role only in practice; auth.uid() policies included for Stackit parity), `updated_at` trigger, `users.personal_ig_username` + `users.extension_token_version`, nullable `leads.rep_id` + `messages.rep_id` + indexes. Fully additive.
- **`EXTENSION_TOKEN_SECRET`**: generated, set in `.env.local` + Vercel production/preview/development, documented in `.env.local.example` (gitignored, local only).

---

## Test results (curl, local dev server, real DB)

| Check | Result |
|---|---|
| Bootstrap with hand-minted repToken → correct C2 JSON | ✅ |
| Bootstrap bad / expired / wrong-issuer token → 401 `{ok:false}` | ✅ |
| Slots without calendar grant → `{needsCalendar:true}` | ✅ |
| Book without grant → `{needsCalendar:true}`; bad payload → 400 zod details | ✅ |
| auth/start evil.com / http / lookalike-path redirect → 400 | ✅ |
| auth/start no session → 302 `/login?callbackUrl=…` (ext_redirect preserved) | ✅ |
| auth/start **with session** (encoded real NextAuth cookie) → 302 `…#token=`, minted token round-trips against bootstrap | ✅ |
| ig-events `x-ig-secret` → lead created, rep_id null | ✅ (test lead deleted) |
| ig-events Bearer repToken → authenticates (no 401) | ✅ |
| `npm run build` + eslint on all touched files | ✅ clean |

**Deferred to post-014** (impossible before the schema exists + a calendar-scoped grant): slots returning real freeBusy slots, book creating a real event, ig-events Bearer stamping `rep_id` in the column.

---

## Files touched

```
NEW  lib/extension-token.ts
NEW  lib/google-calendar.ts
NEW  app/api/extension/auth/start/route.ts
NEW  app/api/extension/bootstrap/route.ts
NEW  app/api/calendar/slots/route.ts
NEW  app/api/calendar/book/route.ts
NEW  supabase/migrations/014_extension_identity.sql
MOD  lib/auth.ts            (calendar scopes + server-side token persistence)
MOD  app/api/ig-events/route.ts   (C4 Bearer + rep_id stamping)
MOD  app/login/page.tsx     (callbackUrl param)
MOD  proxy.ts               (open /api/extension + /api/calendar)
LOCAL .env.local / .env.local.example / Vercel env (EXTENSION_TOKEN_SECRET)
```

No `chrome-extension/**` files touched (T2's domain, per the wave split).
