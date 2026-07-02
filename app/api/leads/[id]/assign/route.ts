// C3 — admin-only reassign/release. POST { owner_id: <userId> | null }.
// null releases the lead back to the shared cold pool (the anti-hoarding
// guard for owned-but-stalled leads).
import { type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { getActor } from "@/lib/scope";
import { canManageTeam } from "@/lib/permissions";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const actor = await getActor(req);
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });
  if (!canManageTeam(actor.role)) return Response.json({ error: "forbidden" }, { status: 403 });

  let body: { owner_id?: string | null };
  try {
    body = await req.json() as { owner_id?: string | null };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.owner_id === undefined) {
    return Response.json({ error: "owner_id required (userId or null)" }, { status: 400 });
  }
  const newOwner = body.owner_id;

  const db = supabaseServer();

  const { data: lead } = await db.from("leads").select("org_id, owner_id").eq("id", id).maybeSingle();
  if (!lead) return Response.json({ error: "not found" }, { status: 404 });
  if (lead.org_id !== actor.orgId) return Response.json({ error: "forbidden" }, { status: 403 });

  // A lead may only be assigned to a member of the same org.
  if (newOwner) {
    const { data: m } = await db
      .from("memberships")
      .select("user_id")
      .eq("org_id", actor.orgId)
      .eq("user_id", newOwner)
      .maybeSingle();
    if (!m) return Response.json({ error: "owner_id is not a member of this org" }, { status: 400 });
  }

  if ((lead.owner_id ?? null) !== (newOwner ?? null)) {
    await db.from("assignment_log").insert({
      lead_id: id,
      from_user: lead.owner_id ?? null,
      to_user: newOwner,
      assigned_by: actor.actorId,
    });
  }

  const { data, error } = await db
    .from("leads")
    .update({ owner_id: newOwner, updated_at: new Date().toISOString() })
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ lead: data });
}
