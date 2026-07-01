// POST /api/salesforce/batch
// Runs SF lookup on all leads where sf_last_checked IS NULL (never checked)
// or older than `staleDays` days (default 7). Processes up to `limit` per call (default 20).
// Responds with a summary; call repeatedly until remaining=0.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { lookupLeadInSalesforce } from "@/lib/salesforce";

const IG_SECRET = process.env.IG_EVENTS_SECRET ?? "";

export async function POST(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (IG_SECRET && auth !== `Bearer ${IG_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json().catch(() => ({})) as { staleDays?: number; limit?: number };
  const staleDays = body.staleDays ?? 7;
  const limit = Math.min(body.limit ?? 20, 50);
  const staleDate = new Date(Date.now() - staleDays * 24 * 3600 * 1000).toISOString();

  const db = supabaseServer();

  const { data: leads, error } = await db
    .from("leads")
    .select("id, name, ig_username, ig_profile_url, research_cache, sf_last_checked, stage")
    .or(`sf_last_checked.is.null,sf_last_checked.lt.${staleDate}`)
    .not("stage", "in", '("Closed","DQ","Churned")')
    .order("created_at", { ascending: true })
    .limit(limit);

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!leads?.length) return NextResponse.json({ ok: true, processed: 0, customers: [], remaining: 0 });

  const customers: { id: string; name: string | null; ig: string | null; sfName: string | null; confidence: number }[] = [];
  let processed = 0;

  for (const lead of leads) {
    try {
      const cache = (lead.research_cache ?? {}) as Record<string, unknown>;
      const externalUrl = typeof cache.externalUrl === "string" ? cache.externalUrl : undefined;

      const sfMatch = await lookupLeadInSalesforce({
        displayName: lead.name ?? undefined,
        igUsername:  lead.ig_username ?? undefined,
        externalUrl,
      });

      await db
        .from("leads")
        .update({
          sf_account_id:       sfMatch.sfAccountId,
          sf_account_name:     sfMatch.sfAccountName,
          sf_status:           sfMatch.sfStatus,
          sf_confidence_score: sfMatch.sfConfidenceScore,
          sf_match_reasons:    sfMatch.sfMatchReasons,
          sf_last_checked:     sfMatch.sfLastChecked,
          updated_at:          new Date().toISOString(),
        })
        .eq("id", lead.id as string);

      if (sfMatch.sfStatus === "customer" && (sfMatch.sfConfidenceScore ?? 0) >= 40) {
        customers.push({
          id: lead.id as string,
          name: lead.name as string | null,
          ig: lead.ig_username as string | null,
          sfName: sfMatch.sfAccountName ?? null,
          confidence: sfMatch.sfConfidenceScore ?? 0,
        });
      }

      processed++;
      await new Promise((r) => setTimeout(r, 200));
    } catch (err) {
      console.error(`[sf-batch] error on ${lead.id}:`, (err as Error).message);
      processed++;
    }
  }

  const { count } = await db
    .from("leads")
    .select("id", { count: "exact", head: true })
    .or(`sf_last_checked.is.null,sf_last_checked.lt.${staleDate}`)
    .not("stage", "in", '("Closed","DQ","Churned")')
    .then((r) => ({ count: r.count ?? 0 }));

  return NextResponse.json({ ok: true, processed, customers, remaining: Math.max(0, (count as number) - processed) });
}
