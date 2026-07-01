# FIX-T1 — Backend Reliability — DONE

Status: **Complete & build-verified** (`npm run build` ✓ compiled successfully, clean).

## What was broken
`app/api/ig-events/route.ts` did an **unguarded** `await inngest.send(...)` before returning the save response. With Inngest keys unset (current state), the whole `IG_PROFILE_SAVE` handler threw — the Chrome extension's Save button errored even though the lead was already written to the DB, and research never triggered. That's the app's #1 feature.

## Changes

### BUILD 1 — Guard the research trigger
**`app/api/ig-events/route.ts`**
- Wrapped `inngest.send({ name: "lead/research.requested", data: { leadId } })` in try/catch.
- On failure: logs the error (for Sentry) and falls back to the old fire-and-forget `fetch(\`${getBaseUrl()}/api/ai/research-lead\`, ...)` (not awaited).
- Save now returns `200 {ok, leadId}` even when Inngest is unreachable. Lead stays `research_status: "pending"` and can be re-researched.
- IG_FOLLOW / IG_LIKE handling untouched.

### BUILD 2 — Base-URL single source of truth
**`lib/base-url.ts`** (new)
```ts
getBaseUrl(): NEXT_PUBLIC_BASE_URL → https://$VERCEL_URL → NEXTAUTH_URL → http://localhost:3000
```
- **`lib/inngest/functions/research-lead.ts`** — replaced inline base-URL expression with `getBaseUrl()`.
- **`app/api/invites/route.ts`** — invite link + `gmail/send` fetch now use `getBaseUrl()`. Fixes the `undefined/login?invite=...` bug when `NEXTAUTH_URL` is unset. Cookie-forwarding + try/catch unchanged.

## Files touched
| File | Action |
|------|--------|
| `app/api/ig-events/route.ts` | modified (BUILD 1) |
| `lib/base-url.ts` | created (BUILD 2) |
| `lib/inngest/functions/research-lead.ts` | modified (BUILD 2) |
| `app/api/invites/route.ts` | modified (BUILD 2) |

## Verification
- ✅ `npm run build` — clean, "Compiled successfully in 3.4s".
- ✅ `grep -rn "process.env.NEXTAUTH_URL" app/api/invites` — no URL-building uses remain.
- ⏳ Runtime steps (live POST with/without Inngest dev server) — **not yet run**; needs a running dev server.

## Still MANUAL (Felipe, not this terminal)
This fix makes saves survive an unconfigured Inngest, but these still require real config:
- Scheduled scoring, daily briefing, automatic research retries → `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` (+ `SENTRY_DSN`, `SLACK_NOTIFICATIONS_WEBHOOK_URL`).
- Before any sign-in works: run `supabase/migrations/011_teams.sql` then `scripts/seed-team.sql` in the Supabase SQL editor.
