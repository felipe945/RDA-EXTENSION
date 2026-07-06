import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { getActor } from "@/lib/scope";
import { canSeeAllLeads } from "@/lib/permissions";
import { getBaseUrl } from "@/lib/base-url";

// GET /api/ai/research-drain?limit=25&dryRun=1
//
// Backfills the opener gap: finds sales IG leads that have never produced an
// opener (research_cache->suggestedOpener is null) and runs research-lead on
// them, throttled. research-lead itself short-circuits any lead already
// "complete" (unless force), so re-runs are cheap/no-ops.
//
// AUTH: Vercel Cron (Authorization: Bearer $CRON_SECRET) OR an admin/owner
// session. Reps can't trigger it.
//
// COST: one Claude structured call + Apify + Salesforce lookup PER lead. Keep
// batch sizes modest — the cron ticks repeatedly, chipping away at the backlog.
// Use ?dryRun=1 to see the eligible count without spending anything.

// Statuses that still owe an opener. "complete" is intentionally excluded
// (research-lead would short-circuit it anyway).
const DRAIN_STATUSES = ["pending", "none", "error", "enriched", "enriched_v2"];

const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 100; // one invocation must finish within maxDuration
const CONCURRENCY = 3;
const PAGE_SIZE = 1000;

function isCronRequest(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  return req.headers.get("authorization") === `Bearer ${secret}`;
}

export async function GET(req: NextRequest) {
  // --- Auth: cron secret or admin/owner session ---
  const cron = isCronRequest(req);
  let orgId: string | null = null;
  if (!cron) {
    const actor = await getActor(req);
    if (!actor) return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    if (!canSeeAllLeads(actor.role)) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }
    orgId = actor.orgId; // admin drains their own org; cron drains all (single-tenant)
  }

  const { searchParams } = req.nextUrl;
  const dryRun = searchParams.get("dryRun") === "1" || searchParams.get("dryRun") === "true";
  const limit = Math.min(
    MAX_LIMIT,
    Math.max(1, parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT)
  );

  const db = supabaseServer();

  // --- Find eligible leads (paginated; then filter suggestedOpener in JS to
  // avoid brittle JSON-path null filters). ---
  const eligible: string[] = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    let q = db
      .from("leads")
      .select("id, research_cache")
      .in("research_status", DRAIN_STATUSES)
      .eq("mode", "sales")
      .not("ig_username", "is", null)
      .order("created_at", { ascending: true })
      .order("id", { ascending: true })
      .range(offset, offset + PAGE_SIZE - 1);
    if (orgId) q = q.eq("org_id", orgId);

    const { data, error } = await q;
    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    const page = data ?? [];
    for (const row of page) {
      const cache = (row.research_cache ?? {}) as Record<string, unknown>;
      const opener = cache.suggestedOpener;
      if (typeof opener !== "string" || opener.trim() === "") {
        eligible.push(row.id as string);
      }
    }
    if (page.length < PAGE_SIZE) break;
  }

  if (dryRun) {
    return NextResponse.json({
      dryRun: true,
      eligible: eligible.length,
      wouldProcess: Math.min(limit, eligible.length),
    });
  }

  // --- Throttled processing of the first `limit` eligible leads ---
  const batch = eligible.slice(0, limit);
  const remaining = eligible.length - batch.length;
  let ok = 0;
  let failed = 0;
  const base = getBaseUrl();
  const queue = [...batch];

  async function worker() {
    while (queue.length) {
      const leadId = queue.shift()!;
      try {
        const res = await fetch(`${base}/api/ai/research-lead`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId }),
        });
        if (res.ok) ok++;
        else failed++;
      } catch (e) {
        failed++;
        console.error("[research-drain] research-lead call failed", leadId, e);
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, batch.length) }, worker));

  // No silent caps — surface exactly how many were left for the next tick.
  console.log(`[research-drain] processed=${batch.length} ok=${ok} failed=${failed} remaining=${remaining}`);

  return NextResponse.json({
    processed: batch.length,
    ok,
    failed,
    remaining,
    eligibleTotal: eligible.length,
  });
}
