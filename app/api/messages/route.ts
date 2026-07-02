import { type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { getActor, canAccessLead, type Actor } from "@/lib/scope";

// Messages hang off a lead, so scope = the lead's scope: verify the lead is
// visible to the actor before returning or writing anything.
async function checkLeadScope(db: ReturnType<typeof supabaseServer>, leadId: string, actor: Actor) {
  const { data: lead } = await db.from("leads").select("org_id, owner_id").eq("id", leadId).maybeSingle();
  if (!lead) return { status: 404, error: "lead not found" };
  if (!canAccessLead(actor, lead)) return { status: 403, error: "forbidden" };
  return null;
}

export async function GET(request: NextRequest) {
  const actor = await getActor(request);
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const db = supabaseServer();
  const { searchParams } = request.nextUrl;
  const leadId = searchParams.get("lead_id");
  const limit = Math.min(parseInt(searchParams.get("limit") || "5", 10), 20);

  if (!leadId) {
    return Response.json({ error: "lead_id required" }, { status: 400 });
  }

  const scopeErr = await checkLeadScope(db, leadId, actor);
  if (scopeErr) return Response.json({ error: scopeErr.error }, { status: scopeErr.status });

  const { data, error } = await db
    .from("messages")
    .select("id, lead_id, channel, direction, body, created_at")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false })
    .limit(limit);

  if (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ messages: data ?? [] });
}

export async function POST(request: NextRequest) {
  // Preferred auth is getActor (session or repToken). x-ig-secret stays as a
  // fallback so pre-CONNECT extensions keep logging replies mid-rollout —
  // same pattern as /api/ig-events.
  const actor = await getActor(request);
  if (!actor) {
    const secret = request.headers.get("x-ig-secret");
    if (secret !== process.env.IG_EVENTS_SECRET) {
      return Response.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  const db = supabaseServer();

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (actor) {
    // Org-scoped, NOT owner-scoped: on the shared IG account every rep's
    // extension detects the same inbound reply and POSTs it (dedup below
    // handles the race), so a rep must be able to log a message on a
    // teammate-owned lead. Cross-org stays closed.
    if (typeof body.lead_id === "string" && body.lead_id) {
      const { data: lead } = await db.from("leads").select("org_id").eq("id", body.lead_id).maybeSingle();
      if (!lead) return Response.json({ error: "lead not found" }, { status: 404 });
      if (lead.org_id !== actor.orgId) return Response.json({ error: "forbidden" }, { status: 403 });
    }
    // Attribute the write to the actor unless the caller already stamped it.
    if (!body.rep_id) body.rep_id = actor.actorId;
  }

  // Idempotency: (lead_id, channel, item_id) identifies one platform message.
  // The shared FanBasis account means every rep's extension detects the same
  // reply and POSTs it — dedup here, where all reps converge. Callers without
  // an item_id (SMS, email, older extensions) keep plain-insert behavior.
  const itemId = typeof body.item_id === "string" && body.item_id ? body.item_id : null;

  if (itemId && body.lead_id && body.channel) {
    const findExisting = () =>
      db.from("messages").select("id, lead_id, channel, direction, body, created_at")
        .eq("lead_id", body.lead_id as string)
        .eq("channel", body.channel as string)
        .eq("item_id", itemId)
        .limit(1)
        .maybeSingle();

    const { data: existing, error: checkError } = await findExisting();
    if (existing) {
      return Response.json({ message: existing, deduped: true }, { status: 200 });
    }

    if (!checkError) {
      const { error, data } = await db.from("messages").insert(body).select().single();
      if (!error) return Response.json({ message: data }, { status: 201 });

      // 23505 = unique violation: another rep inserted between our check and
      // insert (messages_lead_channel_item_uniq). Same reply — return theirs.
      if (error.code === "23505") {
        const { data: winner } = await findExisting();
        return Response.json({ message: winner, deduped: true }, { status: 200 });
      }
      console.error("[messages] insert error:", error.message);
      return Response.json({ error: error.message }, { status: 500 });
    }

    // check failed (e.g. migration 013 not applied yet → item_id column missing):
    // strip the new columns and fall through to the legacy insert path
    console.error("[messages] item_id dedup unavailable:", checkError.message);
    delete body.item_id;
    delete body.thread_id;
  }

  const { error, data } = await db.from("messages").insert(body).select().single();

  if (error) {
    // messages table may not have the column — log but don't crash outreach flow
    console.error("[messages] insert error:", error.message);
    return Response.json({ error: error.message }, { status: 500 });
  }

  return Response.json({ message: data }, { status: 201 });
}
