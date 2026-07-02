// DELETE /api/aes/:id — remove an AE (admin-only, org-scoped).
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
  if (!actor || !canManageTeam(actor.role)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const { id } = await params;
  const db = supabaseServer();
  const { error } = await db
    .from("account_executives")
    .delete()
    .eq("id", id)
    .eq("org_id", actor.orgId);
  if (error) {
    return Response.json({ ok: false, error: getSupabaseErrorMessage(error) }, { status: 500 });
  }
  return Response.json({ ok: true });
}
