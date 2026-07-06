import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { askStructured } from "@/lib/claude";
import { buildResearchPrompt, RESEARCH_TOOL_SCHEMA } from "@/lib/prompts/research";
import { getSupabaseErrorMessage } from "@/lib/supabaseError";
import { log } from "@/lib/logger";
import { fetchIgProfile } from "@/lib/apify";
import { findCrossPlatformHandles } from "@/lib/research/crossPlatform";
import { lookupLeadInSalesforce } from "@/lib/salesforce";
import { getActor } from "@/lib/scope";
import { hasInternalSecret } from "@/lib/internal-auth";

export async function POST(req: NextRequest) {
  // C2: session/repToken actor OR internal CRON_SECRET — anonymous callers get
  // nothing (this route spends Claude + Apify money and writes research_cache).
  const actor = await getActor(req);
  if (!actor && !hasInternalSecret(req)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  let leadId: string | undefined;

  try {
    const body = await req.json();
    leadId = body.leadId as string | undefined;
    const force = body.force === true;

    if (!leadId) {
      return NextResponse.json({ error: "Missing leadId" }, { status: 400 });
    }

    const db = supabaseServer();

    // Step 1: Fetch the lead
    const { data: lead, error: fetchError } = await db
      .from("leads")
      .select("id, org_id, name, ig_username, bio, follower_count, ig_profile_url, research_status")
      .eq("id", leadId)
      .maybeSingle();

    if (fetchError || !lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 400 });
    }

    // Cross-org tamper: an authenticated actor may only research leads in their
    // own org. The CRON_SECRET path (actor null) is trusted and may cross orgs.
    if (actor && lead.org_id !== actor.orgId) {
      return NextResponse.json({ error: "forbidden" }, { status: 403 });
    }

    if (lead.research_status === "complete" && !force) {
      return NextResponse.json({ error: "Research already complete. Pass force: true to re-run." }, { status: 400 });
    }

    // Mark pending before starting
    await db
      .from("leads")
      .update({ research_status: "pending", updated_at: new Date().toISOString() })
      .eq("id", leadId);

    // Step 2: Fetch Apify data first — externalUrl is needed for cross-platform + SF
    const igUsername = lead.ig_username ?? "";
    const apify = igUsername ? await fetchIgProfile(igUsername) : null;
    const externalUrl = apify?.externalUrl || undefined;

    // Persist enriched Apify data immediately so subsequent steps have fresh values
    if (apify) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (apify.bio && apify.bio !== lead.bio)            patch.bio            = apify.bio;
      if (apify.followerCount && apify.followerCount > 0) patch.follower_count = apify.followerCount;
      if (apify.profileUrl)                               patch.ig_profile_url = apify.profileUrl;
      if (Object.keys(patch).length > 1) {
        await db.from("leads").update(patch).eq("id", leadId);
      }
    }

    // Step 2b: Cross-platform search + Salesforce lookup — run in parallel now that externalUrl is known
    const [candidates, sfMatch] = await Promise.all([
      findCrossPlatformHandles({
        username:   igUsername,
        fullName:   apify?.fullName,
        externalUrl,
        apifyToken: process.env.APIFY_TOKEN,
      }),
      lookupLeadInSalesforce({
        displayName: apify?.fullName || lead.name || undefined,
        igUsername:  igUsername || undefined,
        externalUrl: externalUrl || undefined,
      }),
    ]);

    // Step 3: Build research prompt with all enriched data + verified candidates
    const { system, user } = buildResearchPrompt({
      username:       igUsername,
      bio:            apify?.bio            || lead.bio            || "",
      followerCount:  apify?.followerCount  || lead.follower_count || 0,
      profileUrl:     apify?.profileUrl     || lead.ig_profile_url || `https://www.instagram.com/${igUsername}/`,
      fullName:       apify?.fullName       || undefined,
      followingCount: apify?.followingCount || undefined,
      postCount:      apify?.postCount      || undefined,
      isVerified:     apify?.isVerified     || undefined,
      category:       apify?.category       || undefined,
      externalUrl:    externalUrl           || undefined,
      engagementRate: apify?.engagementRate ?? undefined,
      crossPlatformCandidates: candidates.length > 0 ? candidates : undefined,
    });

    // Step 4: Call Claude with structured output — no JSON parsing needed
    const parsed = await askStructured<Record<string, unknown>>(
      system,
      user,
      "submit_research",
      RESEARCH_TOOL_SCHEMA,
      1500,
    );

    // Use real SF data instead of hardcoded false
    parsed.alreadyCustomer = sfMatch.alreadyCustomer;
    if (sfMatch.sfMatchConfidence) {
      parsed.sfStatus          = sfMatch.sfStatus;
      parsed.sfConfidenceScore = sfMatch.sfConfidenceScore;
      parsed.sfMatchReasons    = sfMatch.sfMatchReasons;
    }

    // Step 6: Persist results — research cache + SF fields together
    const fitScore = typeof parsed.fitScore === "number" ? parsed.fitScore : null;
    const { error: updateError } = await db
      .from("leads")
      .update({
        research_cache:  parsed,
        research_status: "complete",
        ...(fitScore !== null ? { score: fitScore } : {}),
        // Salesforce cross-reference (no-op if SF not configured)
        sf_account_id:       sfMatch.sfAccountId,
        sf_account_name:     sfMatch.sfAccountName,
        sf_status:           sfMatch.sfStatus,
        sf_confidence_score: sfMatch.sfConfidenceScore,
        sf_match_reasons:    sfMatch.sfMatchReasons,
        sf_last_checked:     sfMatch.sfLastChecked,
        updated_at:          new Date().toISOString(),
      })
      .eq("id", leadId);

    if (updateError) throw new Error(`DB update failed: ${getSupabaseErrorMessage(updateError)}`);

    return NextResponse.json({ ok: true, leadId, apifyEnriched: !!apify });
  } catch (err) {
    if (leadId) {
      try {
        const db = supabaseServer();
        await db
          .from("leads")
          .update({ research_status: "error", updated_at: new Date().toISOString() })
          .eq("id", leadId);
      } catch { /* best-effort */ }
    }
    log("error", "[research-lead] Error", { err: err instanceof Error ? err.message : String(err) });
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
