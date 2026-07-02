import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { canManageTeam } from "@/lib/permissions";

// GET /api/team → { members: [{ userId, name, email, role, capacity, openLeads }] }
// Admin-only (fail-closed): the member list with workloads is management data.
export async function GET() {
  const session = await getServerSession(authOptions);
  if (!session?.orgId || !canManageTeam(session.role)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = supabaseServer();
  const { data: memberships } = await db
    .from("memberships")
    .select("user_id, role, capacity, users(id, name, email)")
    .eq("org_id", session.orgId);

  // Terminal stages excluded from open-lead workload (matches lib/assignment.ts).
  const { data: openLeads } = await db
    .from("leads")
    .select("assigned_to")
    .eq("org_id", session.orgId)
    .not("stage", "in", '("Closed","DQ","Churned")')
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
