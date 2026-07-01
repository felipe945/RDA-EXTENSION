# FIX-T2 — Type the Team Columns, Drop the Casts

## Files Owned
- `lib/types.ts` (modify — add the 3 columns to the `Lead` type)
- `hooks/useLeads.ts` (modify — normalize the 3 columns)
- `components/Dashboard.tsx` (modify — drop the cast)
- `components/LeadDetailPanel.tsx` (modify — drop the cast)

## Do NOT touch
- `app/api/**`, `lib/base-url.ts`, `lib/inngest/**` — owned by FIX-T1
- Any assignment / auto-assign logic in the components — only the `assigned_to` *read* changes here; the PATCH bodies and button handlers stay exactly as-is

---

## Context

TEAM-T1 added `assigned_to`, `owner_id`, and `org_id` columns to the `leads` table (migration `011_teams.sql`) and the `/api/leads/[id]` + `/api/leads/assign-next` routes that write `assigned_to`. But it never added those fields to the `Lead` TypeScript type. TEAM-T2 worked around that with local casts:

```ts
(lead as Lead & { assigned_to?: string | null }).assigned_to
```

It works **today** only by luck: `normalizeLead` in `hooks/useLeads.ts` does `...raw` spread and `/api/leads` selects `*`, so the DB value passes through untyped. The day anyone refactors `normalizeLead` to an explicit field whitelist, the "My Leads / Team Leads" filter and the assignee dropdown silently read `undefined` on every lead. This closes that trap by typing the columns properly and removing the casts.

---

## BUILD 1: Add the columns to the `Lead` type

In `lib/types.ts`, find the `Lead` type/interface and add these three fields alongside the other nullable columns (e.g. near `dm_sent_at` / `dq_at`):

```ts
  assigned_to: string | null;   // user_id of the rep currently working the lead
  owner_id: string | null;      // user_id of whoever sourced it
  org_id: string | null;        // org the lead belongs to
```

Match the existing style in that file (all the SF/outreach fields are declared the same way).

---

## BUILD 2: Normalize them in `hooks/useLeads.ts`

In `normalizeLead`, add three lines alongside the existing `?? null` fields so the shape is explicit rather than relying on the `...raw` spread:

```ts
    assigned_to:         (raw.assigned_to as string | null) ?? null,
    owner_id:            (raw.owner_id as string | null) ?? null,
    org_id:              (raw.org_id as string | null) ?? null,
```

Keep the leading `...raw` spread and the trailing `as Lead` — this just makes the three team columns first-class instead of incidental.

---

## BUILD 3: Drop the cast in `components/Dashboard.tsx`

Around line 13-16 there's a helper that casts to read `assigned_to`:

```ts
// assigned_to lands on the Lead type once TEAM-T1 adds the column + schema type.
function ...(lead: Lead) {
  return (lead as Lead & { assigned_to?: string | null }).assigned_to ?? null;
}
```

Now that `assigned_to` is on `Lead`, simplify to a direct read:

```ts
function ...(lead: Lead) {
  return lead.assigned_to ?? null;
}
```

Remove the stale `// assigned_to lands on the Lead type once TEAM-T1...` comment. If the helper was only a one-liner wrapper, you may inline `lead.assigned_to` at the call site instead — whichever keeps the "My Leads" scope filter readable. Do not change the filter logic itself.

---

## BUILD 4: Drop the cast in `components/LeadDetailPanel.tsx`

Around line 54-55:

```ts
// assigned_to lands on the Lead type once TEAM-T1 ships the column + schema type.
const currentAssignee = (lead as Lead & { assigned_to?: string | null }).assigned_to ?? "";
```

Simplify:

```ts
const currentAssignee = lead.assigned_to ?? "";
```

Remove the stale comment. Leave the assign dropdown, `handleAssign` PATCH body (line ~63), and Auto-assign button untouched.

---

## VERIFICATION
```
1. npx tsc --noEmit — clean, no errors about assigned_to/owner_id/org_id
2. npm run build — clean
3. grep -rn "as Lead & {" components/ → no remaining assigned_to casts
4. grep -rn "assigned_to lands on the Lead type" → no matches (stale comments gone)
5. Runtime sanity (after 011_teams.sql + seed are run): assign a lead in
   LeadDetailPanel → dropdown reflects the new assignee; the My/Team Leads toggle
   still filters correctly (behavior identical to before — this was type-only)
```

## COORDINATES WITH
- **FIX-T1**: No shared files — safe to run fully in parallel.
- This is a type-safety cleanup only; no runtime behavior changes if the app was already working via the casts. If `tsc` was clean before, it must stay clean after.
