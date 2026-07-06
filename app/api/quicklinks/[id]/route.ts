// DELETE /api/quicklinks/:id — remove a link. Admins can remove team links;
// reps can remove their own personal links (admins can remove either).
import { type NextRequest } from "next/server";
import { getActor } from "@/lib/scope";
import { supabaseServer } from "@/lib/supabase";
import { canManageTeam } from "@/lib/permissions";
import { getSupabaseErrorMessage } from "@/lib/supabaseError";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const actor = await getActor(req);
  if (!actor) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const { id } = await params;
  const db = supabaseServer();

  const { data: link } = await db
    .from("quicklinks")
    .select("user_id, org_id")
    .eq("id", id)
    .maybeSingle();
  if (!link || link.org_id !== actor.orgId) {
    return Response.json({ ok: false, error: "not found" }, { status: 404 });
  }
  const isTeam = link.user_id === null;
  const isOwn = link.user_id === actor.actorId;
  if ((isTeam || !isOwn) && !canManageTeam(actor.role)) {
    return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
  }

  const { error } = await db.from("quicklinks").delete().eq("id", id).eq("org_id", actor.orgId);
  if (error) {
    return Response.json({ ok: false, error: getSupabaseErrorMessage(error) }, { status: 500 });
  }
  return Response.json({ ok: true });
}
