// C6 — per-rep attribution stats, admin only. Counts come from owner_id
// (pipeline ownership) and rep_id (which rep's extension saved the lead).
// Stage counts are current-stage snapshots over owned leads.
import { type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { getActor } from "@/lib/scope";
import { canManageTeam } from "@/lib/permissions";

export async function GET(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageTeam(actor.role)) return Response.json({ error: "forbidden" }, { status: 403 });

  const db = supabaseServer();

  const [{ data: memberships }, { data: leads, error }] = await Promise.all([
    db
      .from("memberships")
      .select("user_id, role, users(name, email)")
      .eq("org_id", actor.orgId),
    db
      .from("leads")
      .select("owner_id, rep_id, stage")
      .eq("org_id", actor.orgId),
  ]);

  if (error) return Response.json({ error: error.message }, { status: 500 });

  const stats = (memberships ?? []).map((m) => {
    const repId = m.user_id as string;
    const owned = (leads ?? []).filter((l) => l.owner_id === repId);
    const byStage = (stage: string) => owned.filter((l) => l.stage === stage).length;
    const user = m.users as unknown as { name: string | null; email: string | null } | null;
    return {
      rep_id: repId,
      name: user?.name ?? user?.email ?? "Unknown",
      role: m.role as string,
      owned: owned.length,
      saved: (leads ?? []).filter((l) => l.rep_id === repId).length,
      dmSent: byStage("DM Sent"),
      replied: byStage("Replied"),
      qualifying: byStage("Qualifying"),
      callOffered: byStage("Call Offered"),
      booked: byStage("Booked"),
      closed: byStage("Closed"),
    };
  });

  return Response.json({ reps: stats });
}
