import { type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { getActor } from "@/lib/scope";
import { getSupabaseErrorMessage } from "@/lib/supabaseError";

// GET  /api/extension/me  → { ok, personalIgUsername }
// PATCH/api/extension/me  { personalIgUsername }  → sets the CALLER's own handle only.
// Auth: getActor = NextAuth session (dashboard) OR Bearer repToken (extension). Under
// /api/extension, which is already on proxy.ts's open allowlist, so it self-authenticates here.

// Instagram handles: letters, numbers, period, underscore, 1–30 chars. Empty = unset.
function normalizeHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const h = raw.trim().replace(/^@/, "").toLowerCase();
  if (h === "") return "";                       // explicit unset is allowed
  return /^[a-z0-9._]{1,30}$/.test(h) ? h : null; // null = invalid → 400
}

export async function GET(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const db = supabaseServer();
  const { data, error } = await db
    .from("users")
    .select("personal_ig_username")
    .eq("id", actor.actorId)
    .maybeSingle();
  if (error) return Response.json({ ok: false, error: getSupabaseErrorMessage(error) }, { status: 500 });

  return Response.json({ ok: true, personalIgUsername: data?.personal_ig_username ?? null });
}

export async function PATCH(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const handle = normalizeHandle(body?.personalIgUsername);
  if (handle === null) {
    return Response.json(
      { ok: false, error: "Use only letters, numbers, periods, and underscores (max 30)." },
      { status: 400 },
    );
  }

  const db = supabaseServer();
  // Self-scoped write: only ever the caller's own row. No user id is read from the body.
  const { error } = await db
    .from("users")
    .update({ personal_ig_username: handle === "" ? null : handle })
    .eq("id", actor.actorId);
  if (error) return Response.json({ ok: false, error: getSupabaseErrorMessage(error) }, { status: 500 });

  return Response.json({ ok: true, personalIgUsername: handle === "" ? null : handle });
}
