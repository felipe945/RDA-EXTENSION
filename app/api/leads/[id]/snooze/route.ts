// C4 — server-side snooze (was extension-only localStorage). POST
// { until: ISO | null }; null clears the snooze. Scoped like a patch: reps
// may snooze cold or own leads, admin any org lead. snoozed_until comes back
// on every C1 leads response.
import { type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { getActor, canAccessLead } from "@/lib/scope";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const actor = await getActor(req);
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  let body: { until?: string | null };
  try {
    body = await req.json() as { until?: string | null };
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  if (body.until === undefined) {
    return Response.json({ error: "until required (ISO timestamp or null)" }, { status: 400 });
  }
  if (body.until !== null && Number.isNaN(Date.parse(body.until))) {
    return Response.json({ error: "until must be an ISO timestamp or null" }, { status: 400 });
  }

  const db = supabaseServer();

  const { data: lead } = await db.from("leads").select("org_id, owner_id").eq("id", id).maybeSingle();
  if (!lead) return Response.json({ error: "not found" }, { status: 404 });
  if (!canAccessLead(actor, lead)) return Response.json({ error: "forbidden" }, { status: 403 });

  const { data, error } = await db
    .from("leads")
    .update({
      snoozed_until: body.until ? new Date(body.until).toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id)
    .select()
    .maybeSingle();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ lead: data });
}
