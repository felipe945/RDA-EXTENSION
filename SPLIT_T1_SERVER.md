# SPLIT · Terminal 1 — SERVER & DATA (roles, ownership, scoping)

**Wave goal:** turn the shared-everything dashboard into **admin (Felipe) sees all / reps see the shared cold pool + their own leads**, with a **Hybrid** ownership rule. You own the server half; T2 owns all UI (dashboard pages + extension) and consumes your endpoints. You own `app/api/**` + `lib/**` + one migration. **You never touch `app/` pages, `components/**`, or `chrome-extension/**`** (T2's domain).

Working dir: `/Users/felipe/unified-sales-ops` · Read `node_modules/next/dist/docs/` before route code (breaking-change Next, per AGENTS.md).

---

## Decisions (locked 2026-07-02)
- **Sole admin = Felipe** (`role` in `owner`/`admin` → admin powers). Everyone else = `rep`, scoped.
- **Hybrid ownership:** `leads.owner_id NULL` = cold, in the shared pool (all reps see it). **Sending the DM is the claim** → on stage→`DM Sent`, stamp `owner_id = actor` if null. Reply detection stamps owner only if still null. No "Claim" button.
- **Admin can reassign / release** a lead (incl. owned-but-stalled) back to the pool — the anti-hoarding guard.
- **Snooze persists server-side** (today it's extension-only localStorage).

## ⚑ Architectural gotcha — enforce in the API layer, NOT RLS
This app is **NextAuth + service-role key**, so Postgres `auth.uid()` is always null and RLS is inert (that's why `user_integrations`' RLS is effectively service-role-only). **Do not** rely on RLS for scoping — every guard lives in the route/query. (Unlike Stackit, which can use RLS because it's on Supabase Auth.)

---

## FROZEN CONTRACTS (identical block in both files — don't change unilaterally)

**Actor resolution:** a request is authenticated by EITHER a NextAuth session (dashboard) OR a Bearer repToken (extension, `verifyRepToken`). Both yield `{ actorId, orgId, role }`. Build one helper `getActor(req)` returning that or 401.

**C1 — Scoped leads.** `GET /api/leads` returns leads filtered by `org_id = actor.orgId` AND:
- admin → all org leads
- rep → `owner_id IS NULL OR owner_id = actor.actorId`
Response rows include `owner_id`, `rep_id`, `snoozed_until`, and (admin only) an `owner_name`. Existing query params (mode/channel/stage/search) still apply on top.

**C2 — Ownership stamping** (in `lib/leads-update.ts applyLeadPatch`, so dashboard + extension both get it): when a patch sets `stage` to `DM Sent` (or `Replied`) and `owner_id` is null → set `owner_id = actorId`. Never overwrite a non-null owner. Reps may only patch a lead that is cold (`owner_id null`) or their own; admin any.

**C3 — Reassign / release** (admin only). `POST /api/leads/:id/assign` `{ owner_id: <userId> | null }` → set/clear `owner_id`. `403` for reps.

**C4 — Snooze.** `POST /api/leads/:id/snooze` `{ until: ISO|null }` → writes `leads.snoozed_until`. Scoped like C2 (own/cold or admin). Leads response (C1) includes `snoozed_until`.

**C5 — Stage update.** `PATCH /api/leads/:id` `{ stage }` accepts all 9 stages, scoped (own/cold or admin), runs C2 stamping. This backs the extension's new full-stage control.

**C6 — Attribution stats** (admin only). `GET /api/stats/reps` → `[{ rep_id, name, owned, dmSent, replied, booked, ... }]` from `owner_id`/`rep_id`. `403` for reps.

**C7 — IG profile URL:** canonical profile link = `https://www.instagram.com/<handle>/` (T2 uses this; noted here so both agree — no `/direct/` for the primary open).

---

## Tasks

### Task 1 — `getActor` + `lib/scope.ts`
`getActor(req)` (session-or-Bearer). `scopeLeadsQuery(qb, actor)` applies org + role/owner filter (C1). Central so every route reuses it.

### Task 2 — lock the read routes (the critical fix)
`app/api/leads/route.ts` GET (`:19-33`), `app/api/messages/route.ts` (`:14-25`), `app/api/notifications/route.ts` (`:10-37`): run through `getActor` + scope. Messages/notifications must verify the lead is in the actor's scope before returning. Today these return everything — this closes the cross-org/cross-rep exposure.

### Task 3 — lock the write routes + C2 stamping
- `lib/leads-update.ts applyLeadPatch` (`~:51`): add `actorId`; implement C2 (stamp owner on DM Sent/Replied if null); reject patches to leads outside actor scope.
- `app/api/leads/route.ts` PATCH/DELETE (`:88`, `:136`) + `app/api/leads/[id]/route.ts` PATCH: thread `getActor`, enforce scope.
- `app/api/ig-events/route.ts`: reply/DM-Sent writes set `owner_id` via the same helper (rep_id already stamped there).

### Task 4 — new routes: assign (C3), snooze (C4), stats (C6)
`app/api/leads/[id]/assign/route.ts`, `app/api/leads/[id]/snooze/route.ts`, `app/api/stats/reps/route.ts`. Admin-gate assign + stats with `canManageTeam(actor.role)` (from `lib/permissions.ts`).

### Task 5 — admin-gate the team/config routes
`app/api/invites` GET (`:13` — POST already gated `:20`), `app/api/team`, and any extension/integration **config** GET: require `canManageTeam`. Fail-closed (deny on missing role).

### Task 6 — migration `016`
`supabase/migrations/016_ownership_snooze.sql`: `alter table leads add column if not exists snoozed_until timestamptz;` + index on `owner_id` and `(org_id, owner_id)`. Additive. (`owner_id`/`rep_id` already exist from 011/014.) Coordinate apply with Felipe (SQL editor) — and **diff live schema first** via PostgREST OpenAPI, since prod has drifted from the migrations dir before (see 007–010/015 incident).

---

## Test checklist (curl, minted repToken + a session cookie)
- [ ] rep token → `GET /api/leads` returns only cold + own; admin → all.
- [ ] rep PATCH stage→DM Sent on a cold lead → `owner_id` becomes that rep; the lead drops out of another rep's `GET /api/leads`.
- [ ] rep tries to PATCH/DELETE a lead owned by someone else → 403.
- [ ] `POST /assign` as rep → 403; as admin → reassigns/releases.
- [ ] `POST /snooze` writes `snoozed_until`; it appears in `GET /api/leads`.
- [ ] `GET /api/stats/reps` admin-only.
- [ ] `npm run build` clean.

## Done when
Every data route is org+role+owner scoped (exposure closed), DM-Sent stamps ownership, admin can reassign/release, snooze persists, per-rep stats exist. Migration `016` written. Commit + push. **T1 drives integration** (apply `016`, then joint end-to-end with T2).
