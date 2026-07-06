// POST /api/leads/batch-enrich
// Runs cross-platform URL scraping + Salesforce check on all "New" leads.
// Does NOT require Gemini/AI — uses website scraping and SF SOAP auth only.
// Safe to re-run: only processes leads where research_status is 'none' or 'error'.

import { type NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { scrapeWebsiteHandles, googleSearchHandles } from "@/lib/research/crossPlatform";
import { lookupLeadInSalesforce } from "@/lib/salesforce";
import { hasInternalSecret } from "@/lib/internal-auth";

const APIFY_TOKEN = process.env.APIFY_TOKEN ?? "";

export async function POST(req: NextRequest) {
  // H1: fail CLOSED — unset CRON_SECRET means nobody passes, not everybody.
  if (!hasInternalSecret(req)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = req.headers.get("content-length") ? await req.json().catch(() => ({})) : {};
  const force = body?.force === true;

  const db = supabaseServer();

  // Fetch leads that need enrichment:
  // - none/error = never processed
  // - pending = stuck (Gemini was down); treat any pending >10min as eligible
  // - force=true: re-process everything (use after fixing bugs)
  const tenMinAgo = new Date(Date.now() - 10 * 60 * 1000).toISOString();

  let query = db
    .from("leads")
    .select("id, name, ig_username, bio, follower_count, ig_profile_url, external_url, research_status, research_cache, sf_last_checked, updated_at")
    .order("created_at", { ascending: true })
    .limit(10);

  if (force) {
    // force mode: re-process "enriched" leads that haven't been google-searched yet (no handles or empty handles)
    // We track this by using research_status = 'enriched' (not yet re-searched)
    // After re-search we set to 'enriched_v2' so next batch skips them
    query = query.eq("research_status", "enriched");
  } else {
    query = query.or(`research_status.in.(none,error),and(research_status.eq.pending,updated_at.lt.${tenMinAgo})`);
  }

  const { data: leads, error } = await query;

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });
  if (!leads || leads.length === 0) return NextResponse.json({ ok: true, processed: 0 });

  let processed = 0;
  let enriched = 0;

  for (const lead of leads) {
    try {
      const externalUrl = (lead.external_url as string | null) ?? undefined;
      const igUsername = (lead.ig_username as string | null) ?? "";
      const fullName = (lead.name as string | null) ?? undefined;

      // Tier 1: Scrape their link-in-bio / website
      const websiteHandles = externalUrl
        ? await scrapeWebsiteHandles(externalUrl)
        : [];

      // Tier 2: Google search for cross-platform handles (only if Apify token set)
      const googleHandles = APIFY_TOKEN && igUsername
        ? await googleSearchHandles(igUsername, fullName, APIFY_TOKEN)
        : [];

      const allHandles = [...websiteHandles, ...googleHandles];

      // Deduplicate by URL
      const seen = new Set<string>();
      const handles = allHandles.filter((h) => {
        const key = h.url.toLowerCase().split("?")[0];
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Salesforce lookup (only if not checked in last 24h)
      const lastChecked = lead.sf_last_checked as string | null;
      const sfStale = !lastChecked || (Date.now() - new Date(lastChecked).getTime()) > 24 * 3600 * 1000;

      const sfMatch = sfStale
        ? await lookupLeadInSalesforce({
            displayName: fullName,
            igUsername: igUsername || undefined,
            externalUrl: externalUrl || undefined,
          })
        : null;

      // Build partial research_cache — merges with any existing cache
      const existing = (lead.research_cache as Record<string, unknown> | null) ?? {};
      const patch: Record<string, unknown> = {
        ...existing,
        crossPlatformHandles: handles,
        enrichedAt: new Date().toISOString(),
      };

      // Extract LinkedIn URL from handles if found
      const linkedinHandle = handles.find((h) => h.platform === "linkedin");
      const twitterHandle = handles.find((h) => h.platform === "twitter");
      const youtubeHandle = handles.find((h) => h.platform === "youtube");

      const dbPatch: Record<string, unknown> = {
        research_cache: patch,
        // enriched_v2 = cross-platform Google search ran; enriched = only placeholder ran
        research_status: "enriched_v2",
        updated_at: new Date().toISOString(),
      };

      // Auto-populate linkedin_url if we found it and it's not set
      if (linkedinHandle && !lead.ig_profile_url) {
        dbPatch.linkedin_url = linkedinHandle.url;
      }

      // Apply SF match data if checked
      if (sfMatch) {
        dbPatch.sf_account_id = sfMatch.sfAccountId;
        dbPatch.sf_account_name = sfMatch.sfAccountName;
        dbPatch.sf_status = sfMatch.sfStatus;
        dbPatch.sf_confidence_score = sfMatch.sfConfidenceScore;
        dbPatch.sf_match_reasons = sfMatch.sfMatchReasons;
        dbPatch.sf_last_checked = sfMatch.sfLastChecked;

        // Auto-DQ if confirmed existing customer
        if (sfMatch.alreadyCustomer && sfMatch.sfConfidenceScore >= 55) {
          dbPatch.research_status = "enriched";
          patch.alreadyCustomer = true;
          patch.dqReason = "existing_customer";
          dbPatch.research_cache = patch;
        }
      }

      // Store twitter/youtube in cache
      if (twitterHandle) patch.twitterUrl = twitterHandle.url;
      if (youtubeHandle) patch.youtubeUrl = youtubeHandle.url;
      dbPatch.research_cache = patch;

      const { error: updateErr } = await db
        .from("leads")
        .update(dbPatch)
        .eq("id", lead.id as string);

      if (!updateErr) {
        enriched++;
        if (handles.length > 0 || sfMatch) {
          console.log(`[batch-enrich] ${igUsername}: ${handles.length} handles, SF=${sfMatch?.sfStatus ?? "skip"}`);
        }
      }

      processed++;

      // Brief pause to avoid hammering external APIs
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      console.error(`[batch-enrich] error on lead ${lead.id}:`, (err as Error).message);
      processed++;
      // Continue with next lead on error
    }
  }

  return NextResponse.json({
    ok: true,
    processed,
    enriched,
    remaining: (leads.length === 10) ? "more" : "all_done",
  });
}
