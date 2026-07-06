# FIX_AUDIT T1 — Backend Hardening · Summary & Checkpoints

> T4 polls `CHECKPOINT_T1_AUTH` before its Task 6 (auth-align). T2 polls
> `CHECKPOINT_T1_RLS` for the realtime decision.

## Checkpoints

- **`CHECKPOINT_T1_AUTH: done @ 4282363`** — auth contract + CORS live. Details below.
- **`CHECKPOINT_T1_RLS: done @ 8da39ca`** — **realtime Option B shipped** (subscriptions
  removed, 30s poll). Details below.
- **`CHECKPOINT_T1_DONE: done @ 8da39ca`** — all six tasks complete, verification below.

---

## CHECKPOINT_T1_AUTH — the contract (for T4)

**Both `/api/opener` (GET) and `/api/ai/research-lead` (POST) now require:**

```
Authorization: Bearer <fb_rep_token>
```

— the same 90-day repToken the extension already sends to `/api/leads` etc.
(`getActor`: NextAuth session OR Bearer repToken). Server-to-server callers use
`Authorization: Bearer $CRON_SECRET` instead (trusted, may cross orgs). No token
→ **401**. Cross-org `lead_id`/`leadId` → **404** (opener) / **403** (research-lead).

**CORS (opener):** `*` is gone. The allowlist reflects the request `Origin` against:
- `NEXT_PUBLIC_BASE_URL`
- `https://fanmas.vercel.app`
- `chrome-extension://$EXTENSION_ID` (env var — **D1: call from the background SW**,
  which sends exactly this Origin)

`Access-Control-Allow-Headers: authorization, content-type` is set, so the
preflight for the Bearer header passes for allowlisted origins. Unknown origins
get **no** ACAO header. Note: if the extension's `host_permissions` already cover
the app domain, SW fetches bypass CORS entirely — the allowlist is belt-and-braces.

**T4 test rig:** a dev server is running on `http://localhost:3000` with
`CRON_SECRET=t1-test-secret` and `EXTENSION_ID=abcdefghijklmnopabcdefghijklmnop`
— use a real repToken for the 200-path, no token for the 401-path.

**Also gated (internal-only, `Bearer $CRON_SECRET`, fail-closed):**
`/api/salesforce/batch`, `/api/leads/batch-enrich` — ⚠️ credential changed from
`IG_EVENTS_SECRET` to `CRON_SECRET`; update any manual curl invocations.
`/api/salesforce` (single) now needs a session/repToken; `/api/leads/assign-next`
is admin/owner-only (reps use the claim path).

## CHECKPOINT_T1_RLS — realtime decision (for T2)

**Option B shipped.** `hooks/useLeads.ts` no longer subscribes to
`postgres_changes` (neither does the inbox). Background refresh = the existing
**30s poll** (now also added to `useLead` and the inbox); `refresh()` on both
hooks is unchanged, so action-driven refetches keep working. **Do not expect
live-tail pushes** — this was already the live behavior: the hand-toggled RLS
meant anon realtime silently stopped firing, and the poll has been carrying the
dashboard since. Option B just deletes the dead code.

Data-path changes T2 might notice:
- `lib/supabase.ts` no longer exports the browser anon client (`supabase`) —
  nothing imported it after this wave; all reads go through `/api/*`.
- `GET /api/messages` (no `lead_id`) is the new org-scoped inbox list
  (`?mode=&direction=&limit=`, lead join included); `PATCH /api/messages`
  `{ ids: [] }` marks read. Reps see pool + own, same as the leads list.

## Migration 020 (Needs Felipe to apply)

`supabase/migrations/020_rls_leads_messages.sql` — ENABLE + FORCE RLS, REVOKE
anon on `leads`/`messages`. Live probe (2026-07-06): anon REST already returns
`[]` on **both** tables (hand-toggle covers them); service-role full. Applying
020 codifies that + hardens empty-array into a permission error. No prod
breakage window: the deployed code no longer uses the anon key anywhere.

## Verification (all run 2026-07-06)

| # | Check | Result |
|---|---|---|
| 1 | `npx tsc --noEmit` + `npm run build` | ✅ clean |
| 2 | `POST /api/ai/research-lead` no auth | ✅ **401** (was 400); wrong secret 401; correct secret → 400 "Missing leadId" (auth passed) |
| 3 | `OPTIONS /api/opener` evil origin → no ACAO; allowed origins (`fanmas.vercel.app`, `chrome-extension://$EXTENSION_ID`) → exact echo; unauth GET → **401** | ✅ |
| 4 | `POST /api/salesforce/batch` + `batch-enrich`, no auth, `CRON_SECRET` unset | ✅ **401** fail-closed (also 401 with random Bearer while unset); correct secret → 200 |
| 5 | Anon REST `leads`/`messages` | ✅ already `[]` live; migration 020 written, awaiting apply |
| 6 | Inbox reads/writes | ✅ code path is `/api/messages` GET/PATCH only (no `/rest/v1/` calls left in the page) |
| 7 | `grep getSupabase\|from("messages")` in inbox + hooks | ✅ gone |
| + | `/api/salesforce` no auth → 401; `/api/leads/assign-next` no auth → 401; `GET/PATCH /api/messages` no auth → 401 | ✅ |

Not live-tested (needs a real session/second org): opener foreign-org 404 and
research-lead cross-org 403 — enforced by `.eq("org_id", actor.orgId)` /
`canAccessLead` on the scoped fetch; the 401 gate in front of both is live-verified.

## Needs Felipe
1. **Vercel env:** set `CRON_SECRET` (⚠️ now *required* — research pipeline
   [Inngest/drain/trigger] authenticates with it and 401s without it) and
   `EXTENSION_ID` (once the Web Store ID is known; unset just means the
   extension origin isn't CORS-allowlisted).
2. **Apply migration 020** in the Supabase dashboard SQL editor.
3. `.env.local.example` is gitignored — updated locally with the new
   CRON_SECRET/EXTENSION_ID docs, not committed.

## Work log
- [x] Task 1 — `lib/internal-auth.ts` (fail-closed `hasInternalSecret`) — `4282363`
- [x] Task 2 — C2: research-lead gated (getActor OR CRON_SECRET; 403 cross-org).
      Internal callers updated to send the secret: `lib/research-trigger.ts`,
      `lib/inngest/functions/research-lead.ts`, `app/api/ai/research-drain/route.ts` — `4282363`
- [x] Task 3 — C3: opener gated + org-scoped + CORS allowlist — `4282363`
- [x] Task 4 — H1: batch routes fail-closed; salesforce + assign-next scoped — `4282363`
- [x] Task 5 — proxy.ts comment block updated (routes self-authenticate) — `4282363`
- [x] Task 6 — migration 020 + inbox/hooks off anon + realtime Option B + anon
      client export removed — `8da39ca`
