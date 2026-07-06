# FIX_AUDIT T1 — Backend Hardening · Summary & Checkpoints

> T4 polls `CHECKPOINT_T1_AUTH` before its Task 6 (auth-align). T2 polls
> `CHECKPOINT_T1_RLS` for the realtime decision.

## Checkpoints

- **`CHECKPOINT_T1_AUTH: done @ 4282363`** — auth contract + CORS live. Details below.
- `CHECKPOINT_T1_RLS:` pending
- `CHECKPOINT_T1_DONE:` pending

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

**Also gated (internal-only, `Bearer $CRON_SECRET`, fail-closed):**
`/api/salesforce/batch`, `/api/leads/batch-enrich` — ⚠️ credential changed from
`IG_EVENTS_SECRET` to `CRON_SECRET`; update any manual curl invocations.
`/api/salesforce` (single) now needs a session/repToken; `/api/leads/assign-next`
is admin/owner-only (reps use the claim path).

## CHECKPOINT_T1_RLS — pending

## Needs Felipe (unchanged from plan)
- Vercel env: set `CRON_SECRET` (now required — research pipeline 401s without it)
  and `EXTENSION_ID` (once the Web Store ID is known).
- Apply migration `020_rls_leads_messages.sql` (Task 6, pending below).
- `.env.local.example` is gitignored — updated locally with the new
  CRON_SECRET/EXTENSION_ID docs, not committed.

## Work log
- [x] Task 1 — `lib/internal-auth.ts` (fail-closed `hasInternalSecret`)
- [x] Task 2 — C2: research-lead gated (getActor OR CRON_SECRET; 403 cross-org).
      Internal callers updated to send the secret: `lib/research-trigger.ts`,
      `lib/inngest/functions/research-lead.ts`, `app/api/ai/research-drain/route.ts`.
- [x] Task 3 — C3: opener gated + org-scoped + CORS allowlist
- [x] Task 4 — H1: batch routes fail-closed; salesforce + assign-next scoped
- [x] Task 5 — proxy.ts comment block updated (routes self-authenticate)
- [ ] Task 6 — migration 020 + inbox off anon + realtime Option B
- [ ] Verification suite
