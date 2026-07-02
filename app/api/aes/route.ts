// Account Executives — the people discovery calls get booked with.
// GET is open to any org actor (dashboard session or extension repToken):
// reps need the list to pick an AE in the booking flow. POST is admin-only.
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
    .from("account_executives")
    .select("id, name, email, active")
    .eq("org_id", actor.orgId)
    .order("created_at", { ascending: true });
  if (error) {
    return Response.json({ ok: false, error: getSupabaseErrorMessage(error) }, { status: 500 });
  }
  return Response.json({ ok: true, aes: data ?? [] });
}

const addSchema = z.object({
  name: z.string().trim().min(1),
  email: z.string().trim().toLowerCase().email(),
});

export async function POST(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor || !canManageTeam(actor.role)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const parsed = addSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "Name and a valid email are required" }, { status: 400 });
  }

  const db = supabaseServer();
  const { data, error } = await db
    .from("account_executives")
    .insert({ org_id: actor.orgId, name: parsed.data.name, email: parsed.data.email })
    .select("id, name, email, active")
    .single();
  if (error) {
    const msg = error.code === "23505" ? "That email is already an AE" : getSupabaseErrorMessage(error);
    return Response.json({ ok: false, error: msg }, { status: 400 });
  }
  return Response.json({ ok: true, ae: data });
}
