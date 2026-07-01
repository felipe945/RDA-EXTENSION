import { NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { pickNextAssignee } from "@/lib/assignment";

// POST /api/leads/assign-next  { leadId } → { ok, assignedTo }
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
