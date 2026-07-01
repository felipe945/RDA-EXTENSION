# HANDOFF — TEAM-T1: Auth Wall, Org/Team Schema, Assignment Backend

Status: **DONE.** `npm run build` passes clean (Next.js 16.2.9, TypeScript check green). All 10 BUILD sections implemented.

## Files created
- `supabase/migrations/011_teams.sql` — users, orgs, memberships, invites, assignment_log + additive `leads.org_id/assigned_to/owner_id` columns and indexes. Fully idempotent (`if not exists`), nullable — safe against the 585 in-flight prospects.
- `scripts/seed-team.sql` — bootstraps FanBasis org + Felipe as owner, backfills `leads.org_id`.
- `proxy.ts` — the auth wall (see deviation #1 below).
- `lib/permissions.ts` — `canSeeAllLeads`, `canManageTeam`, `requireOrgSession`, `Role` type.
- `lib/assignment.ts` — `pickNextAssignee(orgId)` round-robin.
- `lib/leads-update.ts` — shared PATCH core `applyLeadPatch(db, id, fields)` (see deviation #2).
- `app/api/invites/route.ts` — GET list / POST create + Gmail invite email.
- `app/api/team/route.ts` — GET members + workload.
- `app/api/leads/[id]/route.ts` — PATCH with assignment audit logging (see deviation #2).
- `app/api/leads/assign-next/route.ts` — POST one-click auto-assign.

## Files modified
- `lib/auth.ts` — added `pages.signIn`, `signIn` invite-gate callback, org-identity attach in `jwt`, and `userId/orgId/role` in `session`; extended NextAuth type augmentation.
- `app/api/leads/route.ts` — body-based PATCH now delegates to `applyLeadPatch` (identical behavior, no drift with the new `[id]` route). POST still uses `scoreLead` directly.

## Deviations from TEAM_T1_FOUNDATION.md (both required by the real codebase)

**1. `middleware.ts` → `proxy.ts`.** Next.js 16 deprecated and renamed the `middleware` file convention to `proxy` (per `node_modules/next/dist/docs/.../proxy.md`, AGENTS.md told me to check). The bare `export { default } from "next-auth/middleware"` from the spec fails two ways under v16:
  - the proxy loader only statically detects a locally-declared `proxy`/default **function**, not a re-export → build error `must export a function`;
  - the bare form never receives `pages`, so it would redirect to `/api/auth/signin` instead of `/login`.

  Fix: `proxy.ts` declares a `proxy(req, event)` function wrapping `withAuth({ pages: { signIn: "/login" } })`. Same matcher list as the spec. **Behavior is exactly what BUILD 4 intended** — every matched route redirects unauthenticated users to `/login`. If you want the old filename, it won't work on Next 16; `proxy.ts` is the correct location.

**2. `app/api/leads/[id]/route.ts` was CREATED, not modified.** The spec (BUILD 9) said "find the existing PATCH handler" there, but no such file existed — the working PATCH lived in `app/api/leads/route.ts` with `id` in the body. TEAM-T2 calls `PATCH /api/leads/{id}` (id in path), so I created the `[id]` route with the assignment audit logging. To keep the two PATCH paths from drifting, I extracted the shared scoring/merge/update logic into `lib/leads-update.ts` and both routes call it. The body-based `PATCH /api/leads` (used by existing UI: LeadCard, outreach page, etc.) is unchanged in behavior.

Minor: `assignment_log` is only written when `assigned_to` actually changes (no-op PATCHes don't create noise rows), and `/api/invites` forwards the inviter's session cookie to `/api/gmail/send` so the email actually authenticates (the spec's server-to-server fetch would have always 401'd); response includes `emailSent` so T2's UI can decide whether to show the copy/paste fallback.

## ⚠️ Bootstrap order (blocking — do this before ANY sign-in)
1. Run `supabase/migrations/011_teams.sql` in the Supabase SQL editor.
2. Run `scripts/seed-team.sql` in the Supabase SQL editor.
3. Only then sign in. The `signIn` callback is invite-only — without the seed, even Felipe's own first login is rejected (chicken-and-egg the seed exists to solve).

## Contracts for TEAM-T2 (all live now)
- `GET /api/team` → `{ members: [{ userId, name, email, role, capacity, openLeads }] }`
- `GET /api/invites` → `{ invites: [...] }`
- `POST /api/invites` `{ email, role? }` → `{ ok, inviteUrl, emailSent }` (401 unless owner/admin)
- `PATCH /api/leads/[id]` `{ assigned_to: userId | null }` → `{ lead }` (writes assignment_log)
- `POST /api/leads/assign-next` `{ leadId }` → `{ ok, assignedTo }` (409 if no rep under capacity)
- Client session via `useSession()`: `session.userId`, `session.orgId`, `session.role`.

## Note for reconciliation terminal
`/login`, `/settings/team`, and `/api/inngest` already appear in the build output — TEAM-T2 and TEAM-T3 have landed. No file collisions with T1. Verify the end-to-end sign-in flow after the two Supabase scripts are run.

## Verification done
- `npm run build` → clean compile + TypeScript pass; `/api/invites`, `/api/team`, `/api/leads/[id]`, `/api/leads/assign-next` all listed as routes; `ƒ Proxy (Middleware)` registered.
- Remaining runtime checks (steps 3–10 in the spec's VERIFICATION block) require the Supabase scripts to be run first; they are DB/auth-runtime, not build-time.
