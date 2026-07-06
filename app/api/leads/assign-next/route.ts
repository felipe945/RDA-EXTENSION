import { NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { pickNextAssignee } from "@/lib/assignment";
import { getActor, canAccessLead } from "@/lib/scope";
import { canSeeAllLeads } from "@/lib/permissions";

// POST /api/leads/assign-next  { leadId } → { ok, assignedTo }
// Round-robin assignment is an admin/owner action — reps get leads via the
// claim path, not by triggering assignment themselves.
export async function POST(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canSeeAllLeads(actor.role)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { leadId } = await req.json() as { leadId?: string };
  if (!leadId) return Response.json({ error: "leadId required" }, { status: 400 });

  const db = supabaseServer();
  const { data: lead } = await db
    .from("leads")
    .select("org_id, owner_id, assigned_to")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return Response.json({ error: "lead not found" }, { status: 404 });
  if (!canAccessLead(actor, lead)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const nextUserId = await pickNextAssignee(actor.orgId);
  if (!nextUserId) return Response.json({ error: "no eligible rep under capacity" }, { status: 409 });

  await db.from("leads").update({ assigned_to: nextUserId }).eq("id", leadId).eq("org_id", actor.orgId);
  await db.from("assignment_log").insert({
    lead_id: leadId, from_user: lead.assigned_to ?? null, to_user: nextUserId, assigned_by: actor.actorId,
  });

  return Response.json({ ok: true, assignedTo: nextUserId });
}
