# SPLIT · Terminal 2 — UI PARITY (dashboard + extension)

**Wave goal:** admin-vs-rep views + close the dashboard↔extension drift, incl. the IG-handle click Felipe asked for. You own all UI; T1 owns the server and gives you the scoped API + new endpoints. You own **`app/` pages (NOT `app/api/**`)**, `components/**`, and `chrome-extension/ig-lead-tracker/**`. **You never touch `app/api/**` or `lib/**`** (T1's domain).

Working dir: `/Users/felipe/unified-sales-ops`

---

## Decisions (locked 2026-07-02)
Sole admin (Felipe) vs rep · Hybrid ownership (sending DM = claim; owned leads leave the shared pool) · **snooze server-side + on dashboard** · **FULL parity** (incl. notes + follow-up in extension, two-touch on dashboard).

---

## FROZEN CONTRACTS (identical block in both files — don't change unilaterally)

You consume T1's endpoints; auth = NextAuth session (dashboard) or Bearer repToken (extension, already wired).
- **C1 — `GET /api/leads`** returns rows already scoped to the caller (admin=all, rep=cold+own) with `owner_id`, `rep_id`, `snoozed_until`, `owner_name`. You render, you don't filter for security (T1 does) — but you DO use `owner_id` to label "Yours / Unclaimed / {owner_name}".
- **C2 — stamping is automatic:** just PATCH stage→`DM Sent`; the server stamps `owner_id`. No claim UI needed.
- **C3 — `POST /api/leads/:id/assign` `{owner_id|null}`** (admin only) — the reassign/release control (admin UI).
- **C4 — `POST /api/leads/:id/snooze` `{until:ISO|null}`** — replace the localStorage snooze with this; read `snoozed_until` from C1.
- **C5 — `PATCH /api/leads/:id` `{stage}`** — all 9 stages; backs the extension's new full-stage control.
- **C6 — `GET /api/stats/reps`** (admin only) — per-rep stats for the admin view.
- **C7 — IG profile URL = `https://www.instagram.com/<handle>/`.** Primary "open" everywhere. Add `igProfileUrl(handle)` in each surface (separate runtimes, so one copy each).

---

## Tasks

### Task 1 — clickable IG handle + copy-handle (Felipe's ask) — BOTH surfaces
Today the handle is plain text and only "Open + Copy" (opener) exists; dashboard opens the **DM thread**, extension opens the **profile** — inconsistent.
- **Dashboard** `app/outreach/page.tsx:275` (and `components/LeadDetailPanel.tsx:366-371`, `components/LeadCard.tsx`): render `@{ig_username}` as `<a href={igProfileUrl} target="_blank" rel="noreferrer">`; add a small **copy-handle** icon button → `navigator.clipboard.writeText('@'+handle)`. Change the queue's primary "Open" to the **profile** URL (C7); keep "Open DM" as a secondary button.
- **Extension** `sidepanel.js:249` (Leads tab) + `:790` (Outreach card): same — wrap `displayName` in a link to `igProfileUrl`, add copy-handle icon. `igUrl()` (`:81`) already uses the profile URL — keep it, just make the handle itself clickable + add copy.

### Task 2 — full stage control in the extension outreach card
The outreach card only exposes DM Sent / DQ / Book (`sidepanel.js:807-814`), so reps bounce to the dashboard for mid-funnel moves. Add a 9-stage control (dropdown or pill row: New, Warming, DM Sent, Replied, Qualifying, Call Offered, Booked, Closed, DQ) → `PATCH /api/leads/:id {stage}` (C5). Mirror the Leads-tab quick buttons (`:271-273`) to the full set too.

### Task 3 — snooze via server (both surfaces)
Extension: replace the localStorage snooze (`sidepanel.js:335-345`, `:1006-1010`) with `POST /api/leads/:id/snooze` (C4); read `snoozed_until` from C1 for queue filtering (`outreach-queue.js isSnoozed` should consume the server value). Dashboard: add the same snooze control (+1d/+3d/+1w) to the outreach card / lead detail.

### Task 4 — notes + follow-up parity in the extension
Add to the extension outreach card what the dashboard already has: a **notes** textarea (auto-save via `PATCH /api/leads/:id`) and a **follow-up date** setter (+1d/+3d/+7d, matching `components/LeadCard.tsx:221-255`).

### Task 5 — two-touch (FB/Pers) on the dashboard
The extension tracks FanBasis vs personal IG account sends (`sidepanel.js:765-793`, `outreach_channels`); surface this on the dashboard lead detail (read-only display of which accounts touched the lead) so it's not invisible there.

### Task 6 — Admin vs Rep views + per-rep stats
- Make the cosmetic "My Leads / Team Leads" toggle real: it now just reflects the already-scoped C1 data (reps won't even see the toggle). Label leads **Yours / Unclaimed / {owner_name}** using `owner_id`.
- **Admin-only:** a reassign/release control per lead (C3) and a **per-rep stats** panel (C6). Gate these UI bits on `session.role` via `canSeeAllLeads`/`canManageTeam` (already imported in `components/Dashboard.tsx:146`) — but remember the real guard is server-side; this is just show/hide.

### Task 7 — extension manifest bump
`manifest.json` `2.2.0 → 2.3.0` for the Web Store auto-update.

---

## Test checklist
- [ ] Click `@handle` on dashboard queue, dashboard detail, extension leads tab, extension outreach card → all open `instagram.com/<handle>/` in a new tab. Copy-handle icon copies `@handle`.
- [ ] Extension outreach card can move a lead to any of the 9 stages.
- [ ] Snooze in the extension survives a cache clear (persisted) and shows on the dashboard.
- [ ] Notes + follow-up date work from the extension.
- [ ] As a rep account: no team-settings UI, no reassign control, only cold+own leads; as admin: all leads + reassign + per-rep stats.
- [ ] `node --check` (extension JS) + `npm run build` (dashboard) clean.

## Done when
Handle-click opens the profile everywhere with a copy-handle button; the extension has full stage control + notes + follow-up + server snooze; two-touch shows on the dashboard; admin/rep views are real. Manifest 2.3.0. Commit + push.

---

## Integration — after BOTH land (T1 drives)
Merge (no file overlap). Felipe applies migration `016`. Joint end-to-end: two accounts (you=admin, a test rep) → rep sees cold+own only, DM-Sent claims a lead out of the pool, admin reassigns it back, handle-click opens profiles on all four surfaces, snooze persists. Then Web Store upload of 2.3.0.
