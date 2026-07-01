# HANDOFF — TEAM-T3 (Reliability: Sentry, zod, Inngest)

Status: **DONE**. T3's slice compiles and `next build` passes cleanly in isolation
(verified — see "Build" below). All work is independent of T1/T2 except two
minimal edits to `app/api/ig-events/route.ts` and `app/api/sendblue/route.ts`
(validation only, no business-logic changes).

## Dependencies added (package.json)
`zod`, `inngest@4.11.0`, `@sentry/nextjs@10.63.0`.

## Files created
- `.env.local.example` — definitive var list. Cross-checked against
  `grep -rn "process.env." app lib`. Includes the real vars the spec didn't list
  (`SF_USERNAME/PASSWORD/TOKEN/INSTANCE_URL`, `LINKEDIN_LI_AT`, `NEXT_PUBLIC_BASE_URL`)
  and drops the phantom `SENDBLUE_WEBHOOK_SECRET` — the sendblue route actually
  uses `SENDBLUE_API_SECRET` for its `sha256(body + secret)` signature.
- `instrumentation.ts` — `register()` + `onRequestError = Sentry.captureRequestError`
  (used the documented v10 helper rather than a hand-rolled wrapper).
- `sentry.server.config.ts`, `sentry.edge.config.ts` — server/edge init.
- `instrumentation-client.ts` — **added beyond the spec.** @sentry/nextjs v9+ moved
  browser init out of `sentry.client.config.ts` into this file. Without it,
  `NEXT_PUBLIC_SENTRY_DSN` and the `Sentry.captureException` in `global-error.tsx`
  would never send. Also exports `onRouterTransitionStart` for client-nav tracing.
- `app/global-error.tsx` — dark-themed error boundary, captures to Sentry.
- `lib/inngest.ts` — the client (`id: "unified-sales-ops"`).
- `app/api/inngest/route.ts` — `serve()` endpoint wiring all 3 functions.
- `lib/inngest/functions/nightly-scoring.ts` — cron `0 6 * * *`, re-scores active leads.
- `lib/inngest/functions/daily-briefing.ts` — cron `0 13 * * 1-5`, overdue → Slack webhook.
- `lib/inngest/functions/research-lead.ts` — event `lead/research.requested`, 3 retries.

## Files modified
- `next.config.ts` — wrapped with `withSentryConfig` (`silent`, `widenClientFileUpload`).
- `app/api/ig-events/route.ts` — added `igEventSchema` (zod) with 400-on-invalid;
  replaced the fire-and-forget `fetch("/api/ai/research-lead")` with
  `inngest.send({ name: "lead/research.requested", data: { leadId } })`. Business
  logic untouched.
- `app/api/sendblue/route.ts` — added `sendblueSchema` (zod, `.passthrough()` since
  SendBlue field names vary by event type); 400-on-invalid after JSON parse.

## Deviations from the spec (all intentional, verified against live code)
1. **`app/api/sendblue/webhook/route.ts` does NOT exist** — the dir is empty. Only
   `app/api/sendblue/route.ts` was modified. Nothing to do for the webhook subpath.
2. **Inngest v4 API change** — `createFunction` now takes **2 args**; the trigger
   moved into the options object as `triggers: [...]`. The spec's 3-arg
   `createFunction(opts, trigger, handler)` form fails to type-check on v4.11.0.
   All 3 functions use `triggers: [{ cron | event }]`.
3. **research-lead base URL** — used the repo's existing
   `NEXT_PUBLIC_BASE_URL ?? VERCEL_URL ?? localhost` pattern, not `NEXTAUTH_URL`
   (the spec's suggestion), to match how `ig-events` already resolves it.
4. **Sentry v10 (not the spec's assumed API)** — used `captureRequestError` and
   added `instrumentation-client.ts` per current SDK conventions. Verified the
   exports exist in the installed build.

## Build
`npm run build` **passes** for the T3 slice. NOTE: a full-repo build currently
fails on **T1's `proxy.ts`** (the Next 16 rename of `middleware.ts`):

    Error: The file "./proxy.ts" must export a function...

T1's `export { default } from "next-auth/middleware"` re-export isn't recognized
as a valid Next 16 proxy function export. **This is a TEAM-T1 file — not touched
by T3.** Verified T3 builds clean by temporarily moving `proxy.ts` aside and
restoring it byte-for-byte. Flag for the reconciliation pass / TEAM-T1.

## Before deploy
- Register at app.inngest.com → set real `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY`.
- Create a Slack Incoming Webhook → set `SLACK_NOTIFICATIONS_WEBHOOK_URL`.
- Set `SENTRY_DSN` + `NEXT_PUBLIC_SENTRY_DSN`.
- `vercel.json` still has NO `crons` entries — correct: Inngest owns scheduling now.
- Optional follow-up (noted in spec): the `notifications` table has no producer;
  `daily-briefing.ts` is the natural place to also insert overdue rows if the
  dashboard should show a persistent banner. Left out to avoid touching unverified schema.

## Local verification steps (from the spec, for whoever runs it live)
1. `npx inngest-cli@latest dev` → discovers 3 functions at `/api/inngest`.
2. Trigger `nightly-lead-scoring` from the Inngest dev UI → leads re-scored.
3. Trigger `daily-briefing` → Slack webhook receives a message.
4. `POST` malformed JSON (no `username`) to `/api/ig-events` → 400, not 500.
5. Throw inside the research route → Inngest retries 3× with backoff.
