# HANDOFF — TEAM-T2 (Login, Team Settings, Workload & Assignment UI)

Status: **COMPLETE**. `npx tsc --noEmit` clean, `npm run build` passes, all touched
components lint clean. TEAM-T1's endpoints were already live at build time, so this UI
is wired against their **real** contracts (verified, not just the spec stubs).

## Files created
- `app/login/page.tsx` — Google sign-in screen. Handles `?error=AccessDenied` (uninvited
  email) + generic errors. **`useSearchParams` is wrapped in `<Suspense>`** — mandatory in
  Next 16 or the build fails prerendering. Rendered `fixed inset-0` full-bleed; Nav hides
  itself on `/login` (see below).
- `hooks/useTeam.ts` — `{ members, invites, loading, sendInvite, refresh }`. Fetches are
  **hardened** (`safeJson`): a 401/403/404 degrades to empty instead of throwing, so the
  dashboard/panel never crash if an endpoint is unavailable.
- `components/TeamSettings.tsx` — invite form (email + rep/admin) + pending-invite list +
  per-member workload bars (`openLeads/capacity`, turns red when over capacity).
- `app/settings/team/page.tsx` — page shell.

## Files modified
- `components/Nav.tsx` — added **Team** link (`/settings/team`, `Users` icon); added
  signed-in account email + Sign out row in the footer; **`return null` on `/login`** so the
  sidebar doesn't show on the sign-in screen.
- `components/Dashboard.tsx` — **My Leads / Team Leads** toggle (owner/admin only, via
  `canSeeAllLeads(session?.role)`). Renamed `useLeads` result to `allLeads`; `leads` is now
  the scoped view, so source tabs / counts / empty states all scope consistently. Passes
  `assigneeName` to each `LeadCard` (resolved from `useTeam().members`).
- `components/LeadCard.tsx` — optional `assigneeName?` prop → initial-circle badge.
- `components/LeadDetailPanel.tsx` — Assign dropdown + Auto-assign button in the Overview tab.

## Deviations from the T2 spec — READ THIS (reconciliation)
1. **Toasts use the app's own `useToast()` (`@/components/ui/toast`), not `sonner`.** The
   layout mounts `<ToastProvider>`, not sonner's `<Toaster>`, so sonner toasts wouldn't
   render. No new dependency. If you'd rather standardize on sonner, mount its Toaster.
2. **Manual assignment goes through `PATCH /api/leads/[id]` with `{ assigned_to }`** (T1's
   purpose-built, assignment_log-writing route), exactly as its own code comment requests —
   *not* the base `PATCH /api/leads`.
3. **Auto-assign does NOT re-PATCH after `assign-next`.** T1's `assign-next` already persists
   the pick and writes `assignment_log` server-side (it's write-through, not compute-only, so
   it diverges from the spec's `if (ok) handleAssign(...)` example). We just call it and let
   Realtime refresh the panel; the 409 "no eligible rep under capacity" is surfaced as a toast.
4. **`assigned_to` is read via a local cast** — `(lead as Lead & { assigned_to?: string|null })`.
   T1 added the DB column + the `[id]`/`assign-next` routes but did **not** add `assigned_to`
   to the `Lead` type in `lib/types.ts`. **Recommended reconciliation fix:** add
   `assigned_to: string | null` (+ `owner_id`/`org_id` if used) to `Lead` in `lib/types.ts`
   and to `normalizeLead` in `hooks/useLeads.ts`, then drop the casts in Dashboard/LeadDetailPanel.

## Known non-blocking lint
`hooks/useTeam.ts` trips `react-hooks/set-state-in-effect` on `useEffect(() => refresh())` —
**identical to the committed `hooks/useLeads.ts`** (lines 48/87). It does not block `next build`.
Left as-is to match the established hook pattern; fix both hooks together if you want it gone.

## Verified against T1's live contracts
- `GET /api/team` → `{ members: [{ userId, name, email, role, capacity, openLeads }] }` ✓
- `GET /api/invites` → `{ invites: [...] }` ✓ · `POST /api/invites` → `{ ok, inviteUrl, emailSent }` ✓
- `POST /api/leads/assign-next` `{ leadId }` → `{ ok, assignedTo }` (persists + logs) ✓
- `PATCH /api/leads/[id]` `{ assigned_to }` (logs to assignment_log) ✓
- `session.userId` / `session.orgId` / `session.role` populated by T1's `lib/auth.ts` ✓

## Not done (out of T2 scope)
- Invite links land on `/login?invite=<token>`; T1's `signIn` callback gates by **email match**,
  so the token param is informational — the login page doesn't need to consume it. No "accept
  invite" UI was added.
