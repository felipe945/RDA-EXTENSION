import { type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { applyLeadPatch } from "@/lib/leads-update";
import { getSupabaseErrorMessage } from "@/lib/supabaseError";
import { getActor } from "@/lib/scope";

type Ctx = { params: Promise<{ id: string }> };

// PATCH /api/leads/[id] — update a lead by path id (TEAM-T2's assignment UI calls
// this with { assigned_to }; the extension's full-stage control calls it with
// { stage } under a Bearer repToken — C5). Assignment changes are written to
// assignment_log before the update. Shares update/scoping logic with
// PATCH /api/leads via applyLeadPatch so the two entrypoints never drift.
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const actor = await getActor(req);
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: Record<string, unknown>;
  try {
    body = await req.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const db = supabaseServer();

  // Audit assignment changes — but only when the value actually changes.
  if (typeof body.assigned_to !== "undefined") {
    const { data: current } = await db.from("leads").select("assigned_to").eq("id", id).maybeSingle();
    const from = current?.assigned_to ?? null;
    const to = body.assigned_to ?? null;
    if (from !== to) {
      await db.from("assignment_log").insert({
        lead_id: id,
        from_user: from,
        to_user: to,
        assigned_by: actor.actorId,
      });
    }
  }

  // Never let a body `id` override the path id.
  const fields = { ...body };
  delete fields.id;

  const { data, error, status } = await applyLeadPatch(db, id, fields, actor);
  if (error) return Response.json({ error: getSupabaseErrorMessage(error) }, { status: status ?? 500 });
  return Response.json({ lead: data });
}
