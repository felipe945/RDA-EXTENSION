# TEAM-T1 — Auth Wall, Org/Team Schema, Assignment Backend

## Files Owned
- `middleware.ts` (create, repo root)
- `lib/auth.ts` (modify — signIn/jwt/session callbacks)
- `lib/permissions.ts` (create)
- `lib/assignment.ts` (create)
- `supabase/migrations/011_teams.sql` (create)
- `scripts/seed-team.sql` (create)
- `app/api/invites/route.ts` (create)
- `app/api/team/route.ts` (create)
- `app/api/leads/[id]/route.ts` (modify — PATCH gains `assigned_to` handling)
- `app/api/leads/assign-next/route.ts` (create)

## Do NOT touch
- Anything under `components/` or `app/settings/` — owned by TEAM-T2
- `instrumentation.ts`, `lib/inngest*`, `.env.local.example`, any `app/api/*/route.ts` zod validation — owned by TEAM-T3
- Do not add new npm packages — everything here uses `@supabase/supabase-js` and `next-auth`, both already installed

---

## Context

Today the app has **zero login wall** — every dashboard route is public to anyone with the URL — and the schema has **no concept of "whose lead is this."** `lib/auth.ts` only exists to get Gmail send/read OAuth scopes for a single Google account; nothing gates the dashboard, and the `leads` table has no `org_id`/`assigned_to`/`owner_id` column.

Your job: add real multi-user auth (still NextAuth — it already does the hard part of per-user Gmail token refresh, don't replace it), a minimal orgs/teams schema, and the assignment API that TEAM-T2's UI will call. Everything here is **additive** — no destructive changes to the 585 in-flight prospects already in `leads`.

---

## BUILD 1: Migration — orgs, users, memberships, invites, assignment_log

Create `supabase/migrations/011_teams.sql`:

```sql
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  name text,
  created_at timestamptz default now()
);

create table if not exists orgs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  created_at timestamptz default now()
);

create table if not exists memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  role text not null default 'rep',   -- 'owner' | 'admin' | 'rep'
  capacity int not null default 50,   -- open-lead cap for round-robin
  created_at timestamptz default now(),
  unique (org_id, user_id)
);

create table if not exists invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references orgs(id) on delete cascade,
  email text not null,
  role text not null default 'rep',
  token uuid not null default gen_random_uuid(),
  invited_by uuid references users(id),
  expires_at timestamptz not null default (now() + interval '7 days'),
  accepted_at timestamptz,
  created_at timestamptz default now()
);
create unique index if not exists invites_token_idx on invites(token);
create index if not exists invites_email_idx on invites(email);

alter table leads
  add column if not exists org_id uuid references orgs(id),
  add column if not exists assigned_to uuid references users(id),
  add column if not exists owner_id uuid references users(id);

create index if not exists leads_org_id on leads(org_id);
create index if not exists leads_assigned_to on leads(assigned_to);

create table if not exists assignment_log (
  id uuid primary key default gen_random_uuid(),
  lead_id uuid not null references leads(id) on delete cascade,
  from_user uuid references users(id),
  to_user uuid references users(id),
  assigned_by uuid references users(id),
  created_at timestamptz default now()
);
create index if not exists assignment_log_lead_id on assignment_log(lead_id);
```

Run this in the Supabase SQL editor. All columns are nullable/idempotent — nothing breaks before the seed step runs.

---

## BUILD 2: Seed script — bootstrap Felipe as owner

Create `scripts/seed-team.sql` (copy-paste runnable, no manual ID substitution):

```sql
insert into orgs (name) values ('FanBasis')
on conflict do nothing;

insert into users (email, name)
values ('felipe@fanbasis.com', 'Felipe Guimaraes')
on conflict (email) do nothing;

insert into memberships (org_id, user_id, role)
select o.id, u.id, 'owner'
from orgs o, users u
where o.name = 'FanBasis' and u.email = 'felipe@fanbasis.com'
on conflict (org_id, user_id) do nothing;

update leads set org_id = (select id from orgs where name = 'FanBasis' limit 1)
where org_id is null;
```

**Run this manually in Supabase before testing sign-in.** Without it, the sign-in callback in BUILD 3 has no existing `users` row for Felipe and no invite either — first login would be rejected by its own gate. This script is the one-time bootstrap out of that chicken-and-egg problem.

---

## BUILD 3: `lib/auth.ts` — restrict sign-in to invited emails, attach org/role to the session

Add to `authOptions` in `lib/auth.ts`:

```typescript
import { supabaseServer } from "@/lib/supabase";

// add to the Session/JWT type declarations at the top of the file:
declare module "next-auth" {
  interface Session {
    userId?: string;
    orgId?: string;
    role?: "owner" | "admin" | "rep";
  }
}
declare module "next-auth/jwt" {
  interface JWT {
    userId?: string;
    orgId?: string;
    role?: "owner" | "admin" | "rep";
  }
}
```

Add a `pages` config so unauthenticated visitors land on TEAM-T2's login page:

```typescript
export const authOptions: NextAuthOptions = {
  pages: { signIn: "/login" },
  providers: [ /* unchanged */ ],
  // ...
```

Add a `signIn` callback (new — doesn't exist today):

```typescript
async signIn({ user }) {
  if (!user.email) return false;
  const db = supabaseServer();

  const { data: existingUser } = await db
    .from("users").select("id").eq("email", user.email).maybeSingle();
  if (existingUser) return true;

  const { data: invite } = await db
    .from("invites").select("*")
    .eq("email", user.email)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .maybeSingle();
  if (!invite) return false; // not seeded, not invited — block sign-in

  const { data: newUser } = await db
    .from("users").insert({ email: user.email, name: user.name }).select("id").single();
  await db.from("memberships").insert({
    org_id: invite.org_id, user_id: newUser!.id, role: invite.role,
  });
  await db.from("invites").update({ accepted_at: new Date().toISOString() }).eq("id", invite.id);
  return true;
},
```

Extend the existing `jwt` callback (keep all current refresh-token logic, just add this block before the final `return token`):

```typescript
if (!token.userId && token.email) {
  const db = supabaseServer();
  const { data: u } = await db.from("users").select("id").eq("email", token.email as string).maybeSingle();
  if (u) {
    token.userId = u.id;
    const { data: m } = await db.from("memberships").select("org_id, role").eq("user_id", u.id).maybeSingle();
    if (m) { token.orgId = m.org_id; token.role = m.role as "owner" | "admin" | "rep"; }
  }
}
```

Extend the existing `session` callback:

```typescript
async session({ session, token }) {
  session.access_token = token.access_token;
  session.error = token.error;
  session.userId = token.userId;
  session.orgId = token.orgId;
  session.role = token.role;
  return session;
},
```

---

## BUILD 4: `middleware.ts` — the actual auth wall (doesn't exist today)

Create at repo root:

```typescript
export { default } from "next-auth/middleware";

export const config = {
  matcher: [
    "/",
    "/dashboard/:path*",
    "/leads/:path*",
    "/inbox/:path*",
    "/outreach/:path*",
    "/summary/:path*",
    "/scripts/:path*",
    "/settings/:path*",
  ],
};
```

This is the single biggest gap in the app today — every one of those routes is currently public.

---

## BUILD 5: `lib/permissions.ts` — minimal role helpers

Keep this small. Don't build Epic Stack's full action/entity/access permission-triple system yet — 3 roles and ~10 people don't need it. Revisit only if the role model grows.

```typescript
export type Role = "owner" | "admin" | "rep";

export function canSeeAllLeads(role?: Role) {
  return role === "owner" || role === "admin";
}

export function canManageTeam(role?: Role) {
  return role === "owner" || role === "admin";
}

export function requireOrgSession(session: { userId?: string; orgId?: string } | null) {
  if (!session?.userId || !session?.orgId) {
    throw new Error("unauthorized");
  }
}
```

---

## BUILD 6: `lib/assignment.ts` — round-robin auto-balance

No queue, no worker — one function, called synchronously from the assign-next route.

```typescript
import { supabaseServer } from "@/lib/supabase";

export async function pickNextAssignee(orgId: string): Promise<string | null> {
  const db = supabaseServer();

  const { data: reps } = await db
    .from("memberships")
    .select("user_id, capacity")
    .eq("org_id", orgId)
    .eq("role", "rep");
  if (!reps || reps.length === 0) return null;

  const { data: openLeads } = await db
    .from("leads")
    .select("assigned_to")
    .eq("org_id", orgId)
    .not("stage", "in", "(Closed,DQ)")
    .not("assigned_to", "is", null);

  const counts = new Map<string, number>();
  for (const lead of openLeads ?? []) {
    const id = lead.assigned_to as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const eligible = reps
    .map((r) => ({ userId: r.user_id as string, capacity: r.capacity as number, open: counts.get(r.user_id as string) ?? 0 }))
    .filter((r) => r.open < r.capacity)
    .sort((a, b) => a.open - b.open);

  return eligible[0]?.userId ?? null;
}
```

---

## BUILD 7: `app/api/invites/route.ts`

```typescript
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { canManageTeam } from "@/lib/permissions";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.orgId) return Response.json({ error: "unauthorized" }, { status: 401 });
  const db = supabaseServer();
  const { data, error } = await db.from("invites").select("*").eq("org_id", session.orgId).order("created_at", { ascending: false });
  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ invites: data });
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.orgId || !canManageTeam(session.role)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const { email, role } = await req.json() as { email?: string; role?: string };
  if (!email) return Response.json({ error: "email required" }, { status: 400 });

  const db = supabaseServer();
  const { data: invite, error } = await db
    .from("invites")
    .insert({ org_id: session.orgId, email, role: role ?? "rep", invited_by: session.userId })
    .select("token")
    .single();
  if (error) return Response.json({ error: error.message }, { status: 500 });

  // Reuse the existing Gmail-send route — do not build a second email system.
  const inviteUrl = `${process.env.NEXTAUTH_URL}/login?invite=${invite!.token}`;
  try {
    await fetch(`${process.env.NEXTAUTH_URL}/api/gmail/send`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        to: email,
        subject: "You're invited to Unified Sales Ops",
        body: `Sign in with Google to join: ${inviteUrl}`,
      }),
    });
  } catch {
    // Gmail send may require the inviter's own OAuth session — if it fails, the
    // invite row still exists. TEAM-T2's settings UI should surface inviteUrl
    // directly so Felipe can copy/paste it as a fallback.
  }

  return Response.json({ ok: true, inviteUrl });
}
```

---

## BUILD 8: `app/api/team/route.ts` — members + workload, for TEAM-T2's UI

```typescript
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";

export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.orgId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const db = supabaseServer();
  const { data: memberships } = await db
    .from("memberships")
    .select("user_id, role, capacity, users(id, name, email)")
    .eq("org_id", session.orgId);

  const { data: openLeads } = await db
    .from("leads")
    .select("assigned_to")
    .eq("org_id", session.orgId)
    .not("stage", "in", "(Closed,DQ)")
    .not("assigned_to", "is", null);

  const counts = new Map<string, number>();
  for (const lead of openLeads ?? []) {
    const id = lead.assigned_to as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const members = (memberships ?? []).map((m) => ({
    userId: m.user_id,
    name: (m.users as unknown as { name: string })?.name,
    email: (m.users as unknown as { email: string })?.email,
    role: m.role,
    capacity: m.capacity,
    openLeads: counts.get(m.user_id as string) ?? 0,
  }));

  return Response.json({ members });
}
```

Response shape TEAM-T2 should build against:
```json
{ "members": [{ "userId": "...", "name": "Felipe", "email": "felipe@fanbasis.com", "role": "owner", "capacity": 50, "openLeads": 12 }] }
```

---

## BUILD 9: Extend `app/api/leads/[id]/route.ts` PATCH — assignment + audit log

Find the existing PATCH handler. When the body includes `assigned_to`, log the change before writing it:

```typescript
if (typeof body.assigned_to !== "undefined") {
  const session = await getServerSession(authOptions);
  const { data: current } = await db.from("leads").select("assigned_to").eq("id", id).maybeSingle();
  await db.from("assignment_log").insert({
    lead_id: id,
    from_user: current?.assigned_to ?? null,
    to_user: body.assigned_to,
    assigned_by: session?.userId ?? null,
  });
}
```

Keep the rest of the existing PATCH logic unchanged — this just adds logging alongside whatever fields already get updated.

---

## BUILD 10: `app/api/leads/assign-next/route.ts` — one-click auto-assign

```typescript
import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { pickNextAssignee } from "@/lib/assignment";

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.orgId) return Response.json({ error: "unauthorized" }, { status: 401 });

  const { leadId } = await req.json() as { leadId?: string };
  if (!leadId) return Response.json({ error: "leadId required" }, { status: 400 });

  const nextUserId = await pickNextAssignee(session.orgId);
  if (!nextUserId) return Response.json({ error: "no eligible rep under capacity" }, { status: 409 });

  const db = supabaseServer();
  const { data: current } = await db.from("leads").select("assigned_to").eq("id", leadId).maybeSingle();
  await db.from("leads").update({ assigned_to: nextUserId }).eq("id", leadId);
  await db.from("assignment_log").insert({
    lead_id: leadId, from_user: current?.assigned_to ?? null, to_user: nextUserId, assigned_by: session.userId,
  });

  return Response.json({ ok: true, assignedTo: nextUserId });
}
```

---

## VERIFICATION
```
1. Run 011_teams.sql, then scripts/seed-team.sql, in Supabase SQL editor
2. npm run build — no type errors
3. Sign out (clear cookies) → visiting / redirects to /login (even a 404 /login is fine — TEAM-T2 owns that page)
4. Sign in as felipe@fanbasis.com → succeeds (seed row exists)
5. Sign in as any other Google account with no invite → signIn callback returns false, rejected
6. POST /api/invites {"email":"rep@fanbasis.com","role":"rep"} as Felipe → 200, invite row created
7. That rep signs in with Google → users + memberships rows created, invite marked accepted
8. PATCH /api/leads/[id] {"assigned_to": "<rep-user-id>"} → assignment_log row written
9. POST /api/leads/assign-next {"leadId":"..."} → assigns to the rep with fewest open leads under capacity
10. GET /api/team → returns members with correct openLeads counts
```

## COORDINATES WITH
- **TEAM-T2**: `GET /api/team`, `GET/POST /api/invites`, `PATCH /api/leads/[id]` (assigned_to), `POST /api/leads/assign-next` are the 4 endpoints your Team Settings UI and lead-assignment UI call. Shapes are documented in BUILD 7/8/10 above — build against them now, don't wait.
- **TEAM-T2**: `session.role`, `session.orgId`, `session.userId` are available client-side via `useSession()` from `next-auth/react` once BUILD 3 ships.
- **TEAM-T3**: No new env vars introduced by this terminal — invites reuse the existing Gmail-send route and existing Supabase/NextAuth vars. Nothing for you to add to `.env.local.example`.
