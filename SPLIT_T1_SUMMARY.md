# SPLIT · T1 SERVER — SHIPPED (commit e4ce654) · migration 016 APPLIED

All contracts C1–C6 are live and curl-verified (minted rep + admin repTokens against local dev + prod DB). Build clean. Migration 016 applied by Felipe 2026-07-02; snooze write + C1 exposure + null-clear re-verified end-to-end.

## Status vs contracts
- **C1** ✅ `GET /api/leads` org+role scoped; admin rows include `owner_name` (rep rows don't). `snoozed_until` appears once migration 016 is applied.
- **C2** ✅ `applyLeadPatch(db, id, fields, actor)` — scope check (403 outside scope, 404 missing), stamps `owner_id` on stage→`DM Sent`/`Replied` when null. Verified: rep PATCH on cold lead stamped rep; owned-by-other → 403.
- **C3** ✅ `POST /api/leads/[id]/assign` `{owner_id: userId|null}` — admin only (rep → 403), validates member-of-org, audits to `assignment_log`.
- **C4** ✅ `POST /api/leads/[id]/snooze` `{until: ISO|null}` — scoped like C2. Migration 016 applied; write, C1 exposure, and null-clear verified live.
- **C5** ✅ `PATCH /api/leads/[id]` accepts Bearer repToken now (was session-only), no stage whitelist, C2 stamping runs.
- **C6** ✅ `GET /api/stats/reps` admin-only → `{reps: [{rep_id, name, role, owned, saved, dmSent, replied, qualifying, callOffered, booked, closed}]}`. `saved` = leads with that `rep_id`.

## Things T2 must know
1. **proxy.ts changed** (T1 took it — it's the API auth wall): `/api/leads*`, `/api/messages`, `/api/notifications`, `/api/stats` moved to the self-authenticating pass-through list so Bearer-only extension calls reach `getActor`. Session cookies work exactly as before.
2. **`getActor` role for repTokens is resolved live from `memberships`** — role changes take effect without re-minting tokens.
3. **`POST /api/messages` is org-scoped, not owner-scoped** (deliberate): on the shared IG account every rep's extension logs the same inbound reply; dedup still handles the race. `rep_id` is stamped from the actor when absent. x-ig-secret fallback kept for pre-CONNECT extensions.
4. **Extension gotcha**: background.js auto-PATCHes stage→`Replied` on any matched inbound. If the lead is owned by a *different* rep, that PATCH now 403s (C2 contract). The inbound message still logs; the owner's own extension/dashboard flips the stage. Today's `.catch(() => {})` swallows it silently — fine, but don't surface it as an error.
5. **Touchpoints route** (`/api/leads/[id]/touchpoints`) now requires auth + lead scope (was wide open).
6. `GET /api/team` and `GET /api/invites` are now **admin-only** (fail-closed). If a rep-facing page consumed `/api/team`, it will 401 — route it admin-only or tell T1 to split a names-only endpoint.
7. C7 confirmed: canonical IG profile link = `https://www.instagram.com/<handle>/`.

## Integration (T1 drives)
1. ~~Apply migration 016~~ ✅ applied + re-verified 2026-07-02.
2. Joint end-to-end with T2 once the UI half lands.
