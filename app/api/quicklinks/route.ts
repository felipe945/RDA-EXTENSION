// Quicklinks — the Links tab in the extension. Managed on the dashboard:
// admins add TEAM defaults (user_id null, org-wide); any rep adds their own
// PERSONAL links. GET is open to any org actor (the extension reads them via
// bootstrap; this route backs the dashboard manager). POST scope "team" is
// admin-only.
import { type NextRequest } from "next/server";
import { z } from "zod";
import { getActor } from "@/lib/scope";
import { supabaseServer } from "@/lib/supabase";
import { canManageTeam } from "@/lib/permissions";
import { getSupabaseErrorMessage } from "@/lib/supabaseError";

export async function GET(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) return Response.json({ ok: false }, { status: 401 });

  const db = supabaseServer();
  const { data, error } = await db
    .from("quicklinks")
    .select("id, label, url, user_id, sort")
    .eq("org_id", actor.orgId)
    .or(`user_id.is.null,user_id.eq.${actor.actorId}`)
    .order("sort", { ascending: true })
    .order("created_at", { ascending: true });
  if (error) {
    return Response.json({ ok: false, error: getSupabaseErrorMessage(error) }, { status: 500 });
  }
  const team = (data ?? []).filter((l) => l.user_id === null).map(({ id, label, url }) => ({ id, label, url }));
  const personal = (data ?? []).filter((l) => l.user_id === actor.actorId).map(({ id, label, url }) => ({ id, label, url }));
  return Response.json({ ok: true, team, personal, admin: canManageTeam(actor.role) });
}

const addSchema = z.object({
  label: z.string().trim().min(1).max(60),
  url: z.string().trim().url(),
  scope: z.enum(["team", "personal"]).default("personal"),
});

export async function POST(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "A label and a valid URL are required" }, { status: 400 });
  }
  if (parsed.data.scope === "team" && !canManageTeam(actor.role)) {
    return Response.json({ ok: false, error: "Only admins can add team links" }, { status: 403 });
  }

  const db = supabaseServer();
  const { data, error } = await db
    .from("quicklinks")
    .insert({
      org_id: actor.orgId,
      user_id: parsed.data.scope === "team" ? null : actor.actorId,
      label: parsed.data.label,
      url: parsed.data.url,
    })
    .select("id, label, url")
    .single();
  if (error) {
    return Response.json({ ok: false, error: getSupabaseErrorMessage(error) }, { status: 400 });
  }
  return Response.json({ ok: true, link: data, scope: parsed.data.scope });
}
