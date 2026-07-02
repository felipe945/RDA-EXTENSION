import { type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { scoreLead } from "@/lib/scoring";
import { applyLeadPatch } from "@/lib/leads-update";
import { getSupabaseErrorMessage } from "@/lib/supabaseError";
import { getActor, scopeLeadsQuery, canAccessLead } from "@/lib/scope";
import { canSeeAllLeads } from "@/lib/permissions";

// GET /api/leads?mode=sales|csm&stage=X&bucket=overdue|today|upcoming|booked|archived
// C1 — org + role/owner scoped: admin sees all org leads, reps see the shared
// cold pool (owner_id null) + their own. Admin rows carry owner_name.
export async function GET(request: NextRequest) {
  const actor = await getActor(request);
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const db = supabaseServer();
  const { searchParams } = request.nextUrl;

  const mode = searchParams.get("mode");
  const stage = searchParams.get("stage");
  const bucket = searchParams.get("bucket");

  const igUsername = searchParams.get("ig_username");
  const id = searchParams.get("id");

  const isAdmin = canSeeAllLeads(actor.role);
  let query = db
    .from("leads")
    .select((isAdmin ? "*, owner:users!leads_owner_id_fkey(name)" : "*") as string)
    .order("due_at", { ascending: true });
  query = scopeLeadsQuery(query, actor);

  const searchQuery = searchParams.get("search");

  if (id) {
    query = query.eq("id", id);
  } else {
    if (mode) query = query.eq("mode", mode);
    if (stage) query = query.eq("stage", stage);
    if (igUsername) query = query.eq("ig_username", igUsername);
    if (searchQuery && searchQuery.trim()) {
      const q = `%${searchQuery.trim().toLowerCase()}%`;
      query = query.or(`ig_username.ilike.${q},name.ilike.${q},email.ilike.${q},phone.ilike.${q}`);
    }
  }

  if (bucket) {
    const now = new Date();
    const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
    const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
    const tomorrowEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59).toISOString();

    switch (bucket) {
      case "overdue":
        query = query.lt("due_at", todayStart).not("stage", "in", '("Booked","Closed","DQ","Churned")');
        break;
      case "today":
        query = query.gte("due_at", todayStart).lte("due_at", todayEnd);
        break;
      case "upcoming":
        query = query.gt("due_at", todayEnd).lte("due_at", tomorrowEnd);
        break;
      case "booked":
        query = query.eq("stage", "Booked");
        break;
      case "archived":
        query = query.in("stage", ["Closed", "DQ", "Churned"]);
        break;
    }
  }

  const { data, error } = await query;

  if (error) {
    return Response.json({ error: getSupabaseErrorMessage(error) }, { status: 500 });
  }

  // Flatten the admin-only owner embed into owner_name (C1).
  const leads = ((data ?? []) as unknown as Record<string, unknown>[]).map((row) => {
    const { owner, ...rest } = row;
    return isAdmin
      ? { ...rest, owner_name: (owner as { name?: string } | null)?.name ?? null }
      : rest;
  });

  return Response.json({ leads });
}

// POST /api/leads  — create a new lead
export async function POST(request: NextRequest) {
  const actor = await getActor(request);
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const db = supabaseServer();

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Calculate score before insert
  const score = scoreLead({
    bio: body.bio as string | undefined,
    followerCount: body.follower_count as number | undefined,
    externalUrl: body.external_url as string | undefined,
    researchCache: body.research_cache as Record<string, unknown> | undefined,
  });

  // org_id comes from the actor, never the body — a lead created outside the
  // actor's org would be invisible to everyone under C1 scoping.
  const { data, error } = await db
    .from("leads")
    .insert({ ...body, org_id: actor.orgId, score, updated_at: new Date().toISOString() })
    .select()
    .maybeSingle();

  if (error) {
    return Response.json({ error: getSupabaseErrorMessage(error) }, { status: 500 });
  }

  return Response.json({ lead: data }, { status: 201 });
}

// PATCH /api/leads  — update a lead by id (body must include id)
export async function PATCH(request: NextRequest) {
  const actor = await getActor(request);
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const db = supabaseServer();

  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id, ...fields } = body;

  if (!id || typeof id !== "string") {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }

  const { data, error, status } = await applyLeadPatch(db, id, fields, actor);

  if (error) {
    return Response.json({ error: getSupabaseErrorMessage(error) }, { status: status ?? 500 });
  }

  return Response.json({ lead: data });
}

// DELETE /api/leads?id=uuid — scoped like a patch: reps may delete only cold
// or own leads, admin any org lead.
export async function DELETE(request: NextRequest) {
  const actor = await getActor(request);
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  const db = supabaseServer();
  const id = request.nextUrl.searchParams.get("id");

  if (!id) {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }

  const { data: lead } = await db.from("leads").select("org_id, owner_id").eq("id", id).maybeSingle();
  if (!lead) return Response.json({ error: "not found" }, { status: 404 });
  if (!canAccessLead(actor, lead)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  const { error } = await db.from("leads").delete().eq("id", id);

  if (error) {
    return Response.json({ error: getSupabaseErrorMessage(error) }, { status: 500 });
  }

  return Response.json({ ok: true });
}
