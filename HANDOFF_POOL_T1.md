# HANDOFF — POOL Terminal 1 (SERVER + DASHBOARD, per-rep personal touches)

Status: **COMPLETE — build clean, contracts verified, live authed tests deferred**
Date: 2026-07-07

## What was built (file by file)

### 1. `app/api/leads/touch/route.ts` — NEW (BUILD 1)
`POST /api/leads/touch`, body `{ leadId, channel: "ig_fanbasis" | "ig_personal", sent? }` (zod-validated, `sent` defaults true).

- **Auth:** `getActor(req)` from `lib/scope.ts` — the repo's existing dual-auth resolver (NextAuth session for the dashboard OR Bearer repToken for the extension, same as `/api/leads` PATCH). No new auth invented. 401 when neither resolves.
- **Identity:** one `users` lookup by `actor.actorId` (the exact bootstrap pattern, `select("*")` → `user?.name`, `user?.personal_ig_username`) gives `repName` + `personalHandle` for both auth paths.
- **Merge (server-owned shape, Contract TOUCH):**
  - `ig_fanbasis` → `{ sent: true, sentAt, byId, byName }` (shared) / `{ sent: false }` on un-mark.
  - `ig_personal` → per-rep entry in `ig_personal_by[repId] = { sent, sentAt, name, handle }`; legacy `ig_personal` aggregate DERIVED on every write (`sent: true` if any rep sent) for ≤2.12.0 extensions.
- **NO stage writes** anywhere in the route (grep-verified — only comments mention stage).
- **NOT added to `proxy.ts`** — untouched. `/api/leads` is already an open prefix there, so the route self-authenticates in-handler; unauthenticated requests 401 from `getActor`, verified live (see below).
- Response: `{ ok: true, outreach_channels }` — the exact contract T2 codes against.

### 2. `components/TouchChips.tsx` — rewritten (BUILD 2)
- FanBasis chip: `✓ FanBasis IG · <byName> · <date>` when sent (name appended only when present); teal done / gray pending styling preserved.
- Personal chips: one blue (`#3B82F6`-family) chip per `ig_personal_by` entry with `sent: true` — `✓ <name>`, `title` = `@handle · date`. Sorted oldest-first for stable order.
- Empty state: gray `○ Personal IG` chip when no sent per-rep entries.
- Back-compat: legacy-only data (no sent per-rep entries but `ig_personal.sent`) renders a dimmed teal `✓ Personal (unattributed)` chip with date in `title`.
- LinkedIn chip behavior unchanged: rendered only when sent, teal, with date.
- Shape typed locally in the component.

### 3. `app/outreach/page.tsx` — one addition (BUILD 3)
Inside `markSent`'s deferred (5s-undo) timer, immediately after the existing `/api/leads` stage PATCH and before the `/api/messages` POST: fire-and-forget `POST /api/leads/touch` with `{ leadId, channel: "ig_fanbasis" }` (`.catch(() => {})`). Undo fires before the timer, so an undone send records nothing — unchanged.

### 4. `lib/types.ts` — NOT changed
Plan allowed an additive change "only if `outreach_channels` is typed there". It's typed as generic `Record<string, unknown>` (line 58), not a structured shape, so nothing to extend; the TOUCH shape is typed locally in TouchChips per the plan's alternative.

## Deviations from the plan (all additive, none contract-breaking)
1. **Scope check added:** the route selects `org_id, owner_id` alongside `outreach_channels` and enforces `canAccessLead(actor, lead)` (403), matching every other lead write (`applyLeadPatch`, DELETE). The plan snippet omitted this; without it any valid rep token could touch leads in another org.
2. **Zod body validation** (mirrors `app/api/ig-events/route.ts`) instead of unvalidated destructuring — 400 on bad payloads.
3. **Update error handled:** the final `.update()` returns 500 with `getSupabaseErrorMessage` on failure instead of silently returning ok.
4. **`Response.json` instead of `NextResponse.json`** — repo-wide route convention.
5. **byName fallback:** `user.name ?? user.email ?? null` (bootstrap falls back too); TouchChips renders `"Rep"` if a per-rep entry somehow has no name.
6. **Unattributed-chip condition:** renders when there are *no sent* per-rep entries (not strictly "ig_personal_by absent") and legacy `sent` is true — covers the mixed case of an old extension writing the aggregate while unsent per-rep entries exist.

## Do-not-touch compliance
`git status` shows exactly: `M app/outreach/page.tsx`, `M components/TouchChips.tsx`, `?? app/api/leads/touch/` (+ this handoff). Nothing under `chrome-extension/`; `lib/leads-update.ts`, `lib/queue.ts`, `lib/stages.ts`, `proxy.ts` untouched.

## Verification — run vs deferred
| # | Check | Result |
|---|-------|--------|
| 1 | `npm run build` | **PASS** — clean, zero errors/warnings; `/api/leads/touch` in route manifest |
| 2 | Unauthenticated `POST localhost:3000/api/leads/touch` | **PASS** — `401 {"error":"unauthorized"}` (route's own getActor gate; ran against the live dev server on :3000) |
| — | Greps: no `stage` writes in route; no `touch` entry in proxy OPEN_API_PREFIXES; queue calls `/api/leads/touch`; leads-update merge intact | **PASS** (all) |
| 3 | Authed personal touch → `ig_personal_by.<id>` written, `ig_personal` derived, stage unchanged, lead stays queued | **DEFERRED** — needs a live authed session |
| 4 | Authed `ig_fanbasis` touch → `{sent, sentAt, byId, byName}`, stage unchanged | **DEFERRED** — same |
| 5 | Queue flow: DM Sent → stage "DM Sent" + `ig_fanbasis.byName`; undo → neither | **DEFERRED** — needs authed browser session |
| 6 | TouchChips visual states (attributed FanBasis, blue per-rep, legacy unattributed) | **DEFERRED** — needs authed UI + real data |

## For T2 (coordination contract, unchanged)
- Route: `POST /api/leads/touch`, body `{ leadId, channel, sent? }`, auth `Authorization: Bearer <repToken>`, response `{ ok: true, outreach_channels }`.
- Errors: 401 no auth, 400 bad body, 404 unknown lead, 403 out-of-scope lead, 500 db failure.
- Route is live in this working tree's dev server as of this handoff.
