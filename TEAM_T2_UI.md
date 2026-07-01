# TEAM-T2 — Login Page, Team Settings, Workload &amp; Assignment UI

## Files Owned
- `app/login/page.tsx` (create)
- `app/settings/team/page.tsx` (create)
- `components/TeamSettings.tsx` (create)
- `hooks/useTeam.ts` (create)
- `components/Nav.tsx` (modify — add Team link + account menu)
- `components/Dashboard.tsx` (modify — add My Leads / Team Leads toggle)
- `components/LeadCard.tsx` (modify — add assignee badge)
- `components/LeadDetailPanel.tsx` (modify — add Assign dropdown)

## Do NOT touch
- `lib/auth.ts`, `middleware.ts`, any `app/api/*` route — owned by TEAM-T1. Build against the API contracts documented below; don't wait for TEAM-T1 to literally finish first.
- `instrumentation.ts`, `.env.local.example` — owned by TEAM-T3

---

## Context

TEAM-T1 is adding a real login wall (`middleware.ts`) and four API endpoints for team/invite/assignment data. Today none of that has UI: there's no sign-in page, no way to see who's on the team, no way to see workload distribution, and no way to assign a lead to someone other than whoever's looking at it.

Your job is everything visible: the sign-in screen unauthenticated visitors land on, a settings page where Felipe invites teammates and sees who's carrying how much, and the assignment controls on the lead views reps use every day.

**API contracts to build against (owned/implemented by TEAM-T1, same shapes either way):**
- `GET /api/team` → `{ members: [{ userId, name, email, role, capacity, openLeads }] }`
- `GET /api/invites` → `{ invites: [{ id, email, role, token, accepted_at, expires_at }] }`
- `POST /api/invites` body `{ email, role }` → `{ ok: true, inviteUrl }`
- `PATCH /api/leads/[id]` body `{ assigned_to: userId }` → existing route, just pass this field
- `POST /api/leads/assign-next` body `{ leadId }` → `{ ok: true, assignedTo: userId }`
- `useSession()` (from `next-auth/react`, already wrapped in `SessionWrapper`) exposes `session.userId`, `session.orgId`, `session.role` once TEAM-T1 ships their `lib/auth.ts` changes

---

## BUILD 1: `app/login/page.tsx`

This is where `next-auth`'s `pages.signIn` config (set by TEAM-T1) redirects unauthenticated visitors.

```tsx
"use client";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";

export default function LoginPage() {
  const params = useSearchParams();
  const error = params.get("error");

  return (
    <div className="flex min-h-screen items-center justify-center bg-[#070B12]">
      <div className="w-full max-w-sm rounded-xl border border-[#1A2235] bg-[#0F1420] p-8 text-center">
        <h1 className="mb-2 text-xl font-semibold text-[#E2E8F0]">Unified Sales Ops</h1>
        <p className="mb-6 text-sm text-[#94A3B8]">Sign in with your FanBasis Google account.</p>
        {error === "AccessDenied" && (
          <p className="mb-4 rounded-lg bg-[#2A1420] px-3 py-2 text-xs text-[#FF3A69]">
            This account hasn&apos;t been invited yet. Ask an admin to send you an invite first.
          </p>
        )}
        <button
          onClick={() => signIn("google", { callbackUrl: "/" })}
          className="w-full rounded-lg bg-[#FF3A69] px-4 py-2.5 text-sm font-medium text-white hover:opacity-90"
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
```

NextAuth v4 redirects here with `?error=AccessDenied` when the `signIn` callback (TEAM-T1's BUILD 3) rejects an uninvited email — handle that case, it's the most common failure a new teammate will hit.

---

## BUILD 2: `hooks/useTeam.ts`

```typescript
"use client";
import { useEffect, useState, useCallback } from "react";

export type TeamMember = {
  userId: string; name: string; email: string;
  role: "owner" | "admin" | "rep"; capacity: number; openLeads: number;
};
export type Invite = {
  id: string; email: string; role: string; token: string;
  accepted_at: string | null; expires_at: string;
};

export function useTeam() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    const [teamRes, invitesRes] = await Promise.all([
      fetch("/api/team").then((r) => r.json()),
      fetch("/api/invites").then((r) => r.json()),
    ]);
    setMembers(teamRes.members ?? []);
    setInvites(invitesRes.invites ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function sendInvite(email: string, role: string) {
    const res = await fetch("/api/invites", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, role }),
    });
    const data = await res.json();
    await refresh();
    return data as { ok: boolean; inviteUrl?: string; error?: string };
  }

  return { members, invites, loading, sendInvite, refresh };
}
```

---

## BUILD 3: `components/TeamSettings.tsx`

```tsx
"use client";
import { useState } from "react";
import { useTeam } from "@/hooks/useTeam";
import { toast } from "sonner";

export function TeamSettings() {
  const { members, invites, loading, sendInvite } = useTeam();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("rep");
  const [sending, setSending] = useState(false);

  async function handleInvite() {
    if (!email) return;
    setSending(true);
    const result = await sendInvite(email, role);
    setSending(false);
    if (result.ok) {
      toast.success(`Invite sent to ${email}`);
      if (result.inviteUrl) {
        navigator.clipboard.writeText(result.inviteUrl);
        toast.message("Invite link copied — send it directly if email delivery fails");
      }
      setEmail("");
    } else {
      toast.error(result.error ?? "Failed to send invite");
    }
  }

  if (loading) return <div className="text-sm text-[#94A3B8]">Loading team…</div>;

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#94A3B8]">Invite a teammate</h2>
        <div className="flex gap-2">
          <input
            value={email} onChange={(e) => setEmail(e.target.value)} placeholder="teammate@fanbasis.com"
            className="flex-1 rounded-lg border border-[#1A2235] bg-[#0F1420] px-3 py-2 text-sm text-[#E2E8F0]"
          />
          <select value={role} onChange={(e) => setRole(e.target.value)}
            className="rounded-lg border border-[#1A2235] bg-[#0F1420] px-3 py-2 text-sm text-[#E2E8F0]">
            <option value="rep">Rep</option>
            <option value="admin">Admin</option>
          </select>
          <button onClick={handleInvite} disabled={sending}
            className="rounded-lg bg-[#FF3A69] px-4 py-2 text-sm font-medium text-white disabled:opacity-50">
            {sending ? "Sending…" : "Send Invite"}
          </button>
        </div>
        {invites.filter((i) => !i.accepted_at).length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-xs text-[#94A3B8]">
            {invites.filter((i) => !i.accepted_at).map((i) => (
              <li key={i.id}>{i.email} — pending ({i.role})</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#94A3B8]">Workload</h2>
        <div className="flex flex-col gap-2">
          {members.map((m) => {
            const pct = Math.min(100, Math.round((m.openLeads / m.capacity) * 100));
            return (
              <div key={m.userId} className="rounded-lg border border-[#1A2235] bg-[#0F1420] p-3">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-[#E2E8F0]">{m.name} <span className="text-[#5B6B8C]">· {m.role}</span></span>
                  <span className="font-mono text-xs text-[#94A3B8]">{m.openLeads}/{m.capacity}</span>
                </div>
                <div className="mt-2 h-1.5 rounded-full bg-[#1E2640]">
                  <div className="h-1.5 rounded-full bg-[#14B8A6]" style={{ width: `${pct}%` }} />
                </div>
              </div>
            );
          })}
        </div>
      </section>
    </div>
  );
}
```

---

## BUILD 4: `app/settings/team/page.tsx`

```tsx
import { TeamSettings } from "@/components/TeamSettings";

export default function TeamSettingsPage() {
  return (
    <div className="mx-auto max-w-2xl">
      <h1 className="mb-6 text-xl font-semibold text-[#E2E8F0]">Team</h1>
      <TeamSettings />
    </div>
  );
}
```

---

## BUILD 5: `components/Nav.tsx` — add Team link + account menu

Find the nav links list and add a "Team" item. Find where the component renders (or add) a session-aware footer using `useSession`/`signOut` from `next-auth/react`:

```tsx
import { useSession, signOut } from "next-auth/react";

// inside the Nav component:
const { data: session } = useSession();

// add near the existing nav links:
<NavLink href="/settings/team" label="Team" icon={Users} />

// add at the bottom of the sidebar:
{session?.user?.email && (
  <div className="mt-auto flex items-center justify-between border-t border-[#1A2235] px-3 py-3 text-xs text-[#94A3B8]">
    <span className="truncate">{session.user.email}</span>
    <button onClick={() => signOut({ callbackUrl: "/login" })} className="text-[#5B6B8C] hover:text-[#E2E8F0]">
      Sign out
    </button>
  </div>
)}
```

Match whatever icon import convention (`lucide-react`) and `NavLink` pattern the existing file already uses — don't invent a new nav-item structure.

---

## BUILD 6: `components/Dashboard.tsx` — My Leads / Team Leads toggle

Add local state and a segmented control near the existing filters:

```tsx
import { useSession } from "next-auth/react";
import { canSeeAllLeads } from "@/lib/permissions";

// inside the component:
const { data: session } = useSession();
const [scope, setScope] = useState<"mine" | "team">("mine");
const showTeamToggle = canSeeAllLeads(session?.role);

// filter the leads list before rendering:
const scopedLeads = scope === "mine"
  ? leads.filter((l) => l.assigned_to === session?.userId)
  : leads;
```

```tsx
{showTeamToggle && (
  <div className="flex rounded-lg border border-[#1A2235] p-0.5">
    <button onClick={() => setScope("mine")}
      className={`rounded-md px-3 py-1.5 text-xs ${scope === "mine" ? "bg-[#1E2640] text-[#E2E8F0]" : "text-[#94A3B8]"}`}>
      My Leads
    </button>
    <button onClick={() => setScope("team")}
      className={`rounded-md px-3 py-1.5 text-xs ${scope === "team" ? "bg-[#1E2640] text-[#E2E8F0]" : "text-[#94A3B8]"}`}>
      Team Leads
    </button>
  </div>
)}
```

Reps (`role === "rep"`) never see the toggle — they only ever see their own leads, so default `scope` to `"mine"` unconditionally for them (the filter above already does this; just don't render the toggle).

---

## BUILD 7: `components/LeadCard.tsx` — assignee badge

Add a small initial-circle badge next to the existing fit-score badge, using whichever `member` lookup is cheapest (pass `assigneeName` down as a prop from Dashboard, sourced from the `useTeam()` members list):

```tsx
{assigneeName && (
  <span
    title={`Assigned to ${assigneeName}`}
    className="flex h-5 w-5 items-center justify-center rounded-full bg-[#1E2640] text-[10px] font-medium text-[#94A3B8]"
  >
    {assigneeName.charAt(0).toUpperCase()}
  </span>
)}
```

---

## BUILD 8: `components/LeadDetailPanel.tsx` — Assign dropdown

```tsx
import { useTeam } from "@/hooks/useTeam";

// inside the component:
const { members } = useTeam();

async function handleAssign(userId: string) {
  await fetch(`/api/leads/${lead.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ assigned_to: userId || null }),
  });
  // refresh however this component already refetches lead data
}

async function handleAutoAssign() {
  const res = await fetch("/api/leads/assign-next", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leadId: lead.id }),
  });
  const data = await res.json();
  if (data.ok) handleAssign(data.assignedTo);
}
```

```tsx
<div className="flex items-center gap-2">
  <select
    value={lead.assigned_to ?? ""}
    onChange={(e) => handleAssign(e.target.value)}
    className="rounded-lg border border-[#1A2235] bg-[#0F1420] px-2 py-1 text-xs text-[#E2E8F0]"
  >
    <option value="">Unassigned</option>
    {members.map((m) => <option key={m.userId} value={m.userId}>{m.name}</option>)}
  </select>
  <button onClick={handleAutoAssign} className="text-xs text-[#94A3B8] underline">
    Auto-assign
  </button>
</div>
```

---

## VERIFICATION
```
1. Visit the app signed out → redirected to /login, Google sign-in button works
2. Sign in with an uninvited account → see the AccessDenied message on /login
3. As Felipe (owner), open /settings/team → see self listed, invite a test email
4. Invite link is copied to clipboard even if the Gmail-send fetch fails
5. Dashboard shows My Leads / Team Leads toggle for owner/admin, hidden for rep
6. LeadCard shows assignee initial badge when a lead has assigned_to set
7. LeadDetailPanel: change assignee via dropdown → PATCH fires, badge updates
8. LeadDetailPanel: click Auto-assign → lead goes to the rep with fewest open leads
9. Nav shows signed-in email + working Sign Out
```

## COORDINATES WITH
- **TEAM-T1**: All four endpoints above are their contract to keep stable. If a response shape changes, they'll call it out in `HANDOFF_TEAM_T1.md`.
- **TEAM-T1**: `session.role` / `session.orgId` / `session.userId` only populate once their `lib/auth.ts` changes ship — until then `useSession()` will just be missing those fields, not erroring; build defensively (`session?.role`).
- No new env vars or packages needed from this terminal.
