# Production Accuracy & Reliability Gaps

**Audited:** 2026-07-01 against live prod (`https://unified-sales-ops.vercel.app`)
**Method:** Direct probes of prod routes + Vercel env inspection + repo read. Findings are verified, not assumed.

Severity: 🔴 critical (data/security) · 🟠 broken feature · 🟡 known gap (planned)

---

## 🔴 1. API routes are unauthenticated — the whole lead database is publicly readable

The auth wall (`proxy.ts`) only matches **pages**, not API routes. Its matcher is `/`, `/leads`, `/inbox`, `/outreach`, `/summary`, `/scripts`, `/settings` — there is **no `/api/*` entry**.

**Evidence (unauthenticated requests to prod):**
| Request | Result | Expected |
|---------|--------|----------|
| `GET /` | `307` → /login | ✅ correct |
| `GET /api/leads?mode=sales` | **`200` (returns leads)** | ❌ should be 401 |
| `GET /api/notifications` | **`200`** | ❌ should be 401 |
| `POST /api/leads/bulk-import` | `401` | ✅ (has its own guard) |

**Why it's dangerous:** every route uses the Supabase **service-role** key, which bypasses RLS, and there is **no Postgres RLS**. So the only access control is per-route `getServerSession()` — which the core data routes (`/api/leads` GET/POST/PATCH/DELETE, `/api/notifications`, `/api/messages`) **do not have**. Anyone who knows the URL can **read, edit, or delete all 627 leads** via the API. The login page hides the UI, not the data.

**Fix:** add `/api/:path*` to the proxy matcher (excluding `/api/auth` and webhook routes that authenticate by secret, e.g. `/api/ig-events`, `/api/sendblue`), and/or add a shared `requireSession()` guard to the data routes. Then re-run the probe table above and confirm 401s.

---

## 🔴 2. Background jobs don't run in prod — including the importer's AI research

`GET /api/inngest` returns **`{"code":"internal_server_error"}` (500)** in prod because `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` are **not set** in Vercel.

**Consequences:**
- **Nightly scoring** — never runs.
- **Daily briefing** — never runs.
- **Research retry/backoff** — never runs.
- **Bulk-import "run AI research" opt-in** — enqueues to Inngest → send fails → those leads sit at `research_status: "pending"` forever with **no drain**.

> Note: single IG saves from the Chrome extension still research fine — the `ig-events` route has a direct-fetch fallback when Inngest is down. **Bulk import does not** (by design, to avoid blasting the API — but that means it needs either Inngest or a throttled direct-drain).

**Fix (either):**
1. Add `INNGEST_EVENT_KEY` + `INNGEST_SIGNING_KEY` to Vercel (from inngest.com dashboard), redeploy, confirm `/api/inngest` returns 200. **or**
2. Add a throttled direct-drain to bulk-import so opt-in research works without Inngest.

---

## 🟠 3. Integrations silently dead — env vars missing in prod

**Present in prod:** Supabase (url/anon/service), Anthropic, Google OAuth (client id/secret), NextAuth (secret/url), Apify, Salesforce (SF_*), IG_EVENTS_SECRET, Gemini.

**Missing — each disables a feature with no visible error:**
| Missing var | What breaks |
|-------------|-------------|
| `SENDBLUE_API_KEY`, `SENDBLUE_WEBHOOK_SECRET` | SMS send + inbound replies |
| `SLACK_NOTIFICATIONS_WEBHOOK_URL` | Daily briefing has nowhere to deliver |
| `LINKEDIN_LI_AT` | LinkedIn tracking |
| `SENTRY_DSN` | **Error tracking — so all failures above are invisible.** This is why these gaps aren't obvious from the UI. |
| `NEXT_PUBLIC_BASE_URL` | Has a fallback — non-blocking |

**Fix:** add each var as the corresponding channel is actually needed. Add `SENTRY_DSN` first so future failures surface.

---

## 🟠 4. Imported leads come in unscored

CSV rows carry no bio/follower data, so `scoreLead()` returns ~0 (or 15 if a website column maps). Leads only get a real score once AI research runs — which per **#2** currently won't. So freshly imported leads look unscored/unresearched until #2 is fixed.

**Fix:** resolved automatically once #2 is fixed (research backfills the scores).

---

## 🟡 5. Known feature gaps (planned, not regressions)

- **Unified inbox** covers IG + SMS only — no email or LinkedIn reply detection.
- **No real Postgres RLS** — deferred to Phase 4; compounds #1.
- **No tests** — no Vitest/Playwright/MSW despite being planned.
- **`vercel.json` has no cron entries** — scheduled jobs were meant to run via Inngest (see #2), not Vercel cron.

---

## Priority order to make it accurate

1. **#1 — lock down `/api/*`** (data is currently public). Code fix, ~30 min.
2. **#2 — Inngest keys _or_ bulk-import direct-drain** (jobs + import research). Fixes #4 too.
3. **#3 — `SENTRY_DSN` first**, then other integration vars as needed.
4. **#5 — RLS + tests** as a later hardening pass.

## Verified-working (not broken)

- Prod deploy is live and green; page-level auth redirects correctly.
- Migration 012 applied: 627 leads, 0 duplicates, `leads_org_ig_unique` index present — duplicates now impossible.
- Bulk-import route + modal deployed; the route's own auth gate works (401).
- GitHub → Vercel auto-deploy connected (production branch `main`).
