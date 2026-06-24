import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { ask } from "@/lib/claude";
import { buildResearchPrompt } from "@/lib/prompts/research";
import { fetchIgProfile } from "@/lib/apify";
import { findCrossPlatformHandles } from "@/lib/research/crossPlatform";

export async function POST(req: NextRequest) {
  let leadId: string | undefined;

  try {
    const body = await req.json();
    leadId = body.leadId as string | undefined;

    if (!leadId) {
      return NextResponse.json({ error: "Missing leadId" }, { status: 400 });
    }

    const db = supabaseServer();

    // Step 1: Fetch the lead
    const { data: lead, error: fetchError } = await db
      .from("leads")
      .select("id, ig_username, bio, follower_count, ig_profile_url, research_status")
      .eq("id", leadId)
      .single();

    if (fetchError || !lead) {
      return NextResponse.json({ error: "Lead not found" }, { status: 400 });
    }

    if (lead.research_status === "complete") {
      return NextResponse.json({ error: "Research already complete" }, { status: 400 });
    }

    // Mark pending before starting
    await db
      .from("leads")
      .update({ research_status: "pending", updated_at: new Date().toISOString() })
      .eq("id", leadId);

    // Step 2: Apify IG enrichment + cross-platform search — run in parallel
    const igUsername = lead.ig_username ?? "";
    const [apify, crossPlatformCandidates] = await Promise.all([
      igUsername ? fetchIgProfile(igUsername) : Promise.resolve(null),
      // Cross-platform runs after we know the external URL — done in step 2b below
      Promise.resolve(null as null),
    ]);

    // Step 2b: Deep cross-platform search using the external URL Apify found
    const externalUrl = apify?.externalUrl || undefined;
    const candidates = await findCrossPlatformHandles({
      username:   igUsername,
      fullName:   apify?.fullName,
      externalUrl,
      apifyToken: process.env.APIFY_TOKEN,
    });

    void crossPlatformCandidates; // unused placeholder from parallel destructure

    // Persist enriched data back to lead record
    if (apify) {
      const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
      if (apify.bio && apify.bio !== lead.bio)            patch.bio            = apify.bio;
      if (apify.followerCount && apify.followerCount > 0) patch.follower_count = apify.followerCount;
      if (apify.profileUrl)                               patch.ig_profile_url = apify.profileUrl;
      if (Object.keys(patch).length > 1) {
        await db.from("leads").update(patch).eq("id", leadId);
      }
    }

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

    // Step 4: Call Gemini
    const raw = await ask(system, user, 1500);

    // Step 5: Parse response
    let parsed: Record<string, unknown>;
    try {
      const cleaned = raw.replace(/^```(?:json)?\n?/, "").replace(/\n?```$/, "").trim();
      parsed = JSON.parse(cleaned);
    } catch {
      await db
        .from("leads")
        .update({ research_status: "error", updated_at: new Date().toISOString() })
        .eq("id", leadId);
      return NextResponse.json({ error: "Failed to parse Gemini response" }, { status: 500 });
    }

    parsed.alreadyCustomer = false;

    // Step 6: Persist results
    const fitScore = typeof parsed.fitScore === "number" ? parsed.fitScore : null;
    const { error: updateError } = await db
      .from("leads")
      .update({
        research_cache: parsed,
        research_status: "complete",
        ...(fitScore !== null ? { score: fitScore } : {}),
        updated_at: new Date().toISOString(),
      })
      .eq("id", leadId);

    if (updateError) throw new Error(`DB update failed: ${updateError.message}`);

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
    console.error("[research-lead] Error:", err);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
