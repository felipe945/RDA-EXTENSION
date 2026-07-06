import { type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { scoreLead } from "@/lib/scoring";
import { applyLeadPatch } from "@/lib/leads-update";
import { getSupabaseErrorMessage } from "@/lib/supabaseError";
import { getActor, scopeLeadsQueryFor, canAccessLead, type LeadScope } from "@/lib/scope";
import { canSeeAllLeads } from "@/lib/permissions";
import { stageSqlList, TERMINAL_STAGES } from "@/lib/stages";

// Supabase caps a single response at a fixed number of rows (default 1000). We
// fetch in full-size pages via .range() and stop on the first short page, so the
// response is ALWAYS complete — see the invariant comment in GET.
const PAGE_SIZE = 1000;

// GET /api/leads?mode=sales|csm&stage=X&bucket=overdue|today|upcoming|booked|archived&scope=mine|team
// C1 (scoped) — org + role/owner scoped. Reps always see the shared cold pool
// (owner_id null) + their own. Admin/owner: ?scope=mine → own working queue;
// ?scope=team or no scope (back-compat) → all org leads (rows carry owner_name).
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
  const searchQuery = searchParams.get("search");

  // No scope param → null → today's behavior exactly (back-compat: old
  // extension builds and other callers). Anything not "mine"/"team" is ignored.
  const scopeParam = searchParams.get("scope");
  const scope: LeadScope | null =
    scopeParam === "mine" || scopeParam === "team" ? scopeParam : null;

  const isAdmin = canSeeAllLeads(actor.role);
  // Narrowed const so the makeQuery closure keeps actor's non-null type.
  const scopedActor = actor;

  // Rebuilt fresh per page so we can re-apply .range(). Cold-pool leads have a
  // null due_at (we DON'T fabricate one — that would flood follow-up views), so
  // the pool is ordered by created_at desc, not due_at.
  function makeQuery() {
    let query = db
      .from("leads")
      .select((isAdmin ? "*, owner:users!leads_owner_id_fkey(name)" : "*") as string)
      // created_at desc, id as a stable tiebreaker so range() paging across
      // pages can't skip or duplicate rows that share a created_at.
      .order("created_at", { ascending: false })
      .order("id", { ascending: true });
    query = scopeLeadsQueryFor(query, scopedActor, scope);

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
          // Booked + terminal stages don't count as overdue follow-ups.
          query = query.lt("due_at", todayStart).not("stage", "in", stageSqlList(["Booked", ...TERMINAL_STAGES]));
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
          query = query.in("stage", [...TERMINAL_STAGES]);
          break;
      }
    }
    return query;
  }

  // INVARIANT: the response must never silently truncate. Loop full-size pages
  // until a short page; concatenate. A single-id lookup returns ≤1 row so the
  // first page is always the last.
  const rows: Record<string, unknown>[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const { data, error } = await makeQuery().range(offset, offset + PAGE_SIZE - 1);
    if (error) {
      return Response.json({ error: getSupabaseErrorMessage(error) }, { status: 500 });
    }
    const page = (data ?? []) as unknown as Record<string, unknown>[];
    rows.push(...page);
    if (page.length < PAGE_SIZE) break;
  }

  // Flatten the admin-only owner embed into owner_name (C1).
  const leads = rows.map((row) => {
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
