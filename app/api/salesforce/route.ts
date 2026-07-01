import { type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { lookupLeadInSalesforce } from "@/lib/salesforce";

// POST /api/salesforce  { leadId }
// Manually re-runs the SF lookup for one lead and updates the DB.
// Useful after editing a lead's name/URL or when re-checking after 7 days.
export async function POST(req: NextRequest) {
  const db = supabaseServer();

  let leadId: string;
  try {
    const body = await req.json() as { leadId?: string };
    if (!body.leadId) return Response.json({ error: "Missing leadId" }, { status: 400 });
    leadId = body.leadId;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { data: lead, error: fetchErr } = await db
    .from("leads")
    .select("id, name, ig_username, ig_profile_url, research_cache")
    .eq("id", leadId)
    .single();

  if (fetchErr || !lead) {
    return Response.json({ error: "Lead not found" }, { status: 404 });
  }

  const cache = (lead.research_cache ?? {}) as Record<string, unknown>;
  const externalUrl = typeof cache.externalUrl === "string" ? cache.externalUrl : undefined;

  const sfMatch = await lookupLeadInSalesforce({
    displayName: lead.name ?? undefined,
    igUsername:  lead.ig_username ?? undefined,
    externalUrl: externalUrl,
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
    .eq("id", leadId);

  return Response.json({ ok: true, sfMatch });
}
