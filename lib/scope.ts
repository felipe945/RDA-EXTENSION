// Central actor resolution + lead scoping (SPLIT wave, contracts C1/C2).
//
// ⚑ All scoping lives HERE and in the routes — never in RLS. The app talks to
// Postgres with the service-role key (NextAuth, not Supabase Auth), so
// auth.uid() is always null and RLS policies are inert.
import { type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { verifyRepToken } from "@/lib/extension-token";
import { canSeeAllLeads, type Role } from "@/lib/permissions";

export interface Actor {
  actorId: string;
  orgId: string;
  role: Role;
}

// A request is authenticated by EITHER a NextAuth session (dashboard) or a
// Bearer repToken (extension). Both resolve to the same Actor shape; routes
// 401 on null. The repToken carries identity but not role, so that path does
// a membership lookup (also picks up role changes without re-minting tokens).
export async function getActor(req: NextRequest): Promise<Actor | null> {
  const session = await getServerSession(authOptions);
  if (session?.userId && session?.orgId) {
    return { actorId: session.userId, orgId: session.orgId, role: session.role ?? "rep" };
  }

  const rep = await verifyRepToken(req.headers.get("authorization"));
  if (!rep) return null;

  const db = supabaseServer();
  const { data: m } = await db
    .from("memberships")
    .select("org_id, role")
    .eq("user_id", rep.rep_id)
    .maybeSingle();
  if (!m?.org_id) return null; // no membership → no org to scope to → deny

  return { actorId: rep.rep_id, orgId: m.org_id as string, role: (m.role as Role) ?? "rep" };
}

// The two lead views the dashboard toggles between.
//  - "mine" → the actor's working queue: shared cold pool (owner_id null) + own.
//  - "team" → the whole org (admin/owner only).
export type LeadScope = "mine" | "team";

// C1 (scoped) — org + role/owner filter for leads list queries, parameterized
// by the requested view. Reps are ALWAYS confined to pool + own no matter what
// scope they ask for (enforcement unchanged). Admin/owner get:
//   scope="mine"                 → pool + own (their working queue)
//   scope="team" | null (legacy) → org-wide (today's default behavior)
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scopeLeadsQueryFor<T extends { eq: any; or: any }>(
  query: T,
  actor: Actor,
  scope?: LeadScope | null
): T {
  let q = query.eq("org_id", actor.orgId);
  const restrictToMine = !canSeeAllLeads(actor.role) || scope === "mine";
  if (restrictToMine) {
    q = q.or(`owner_id.is.null,owner_id.eq.${actor.actorId}`);
  }
  return q;
}

// C1 — back-compat entry point: org-wide for admin, pool+own for reps. Exactly
// today's behavior. Kept so callers that don't care about the mine/team toggle
// (notifications, team, salesforce, etc.) need zero changes.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function scopeLeadsQuery<T extends { eq: any; or: any }>(query: T, actor: Actor): T {
  return scopeLeadsQueryFor(query, actor, "team");
}

// Single-lead scope check (C2): reps may touch a lead only if it's cold
// (owner_id null) or their own; admin/owner any lead in their org.
export function canAccessLead(
  actor: Actor,
  lead: { org_id?: string | null; owner_id?: string | null }
): boolean {
  if (lead.org_id !== actor.orgId) return false;
  if (canSeeAllLeads(actor.role)) return true;
  return lead.owner_id == null || lead.owner_id === actor.actorId;
}
