/**
 * Universal lead importer — scrapes following lists (Instagram, Twitter)
 * or does a keyword people search (LinkedIn), filters for coaches, imports to Supabase.
 *
 * Usage:
 *   Instagram (default):
 *     npx tsx --env-file=.env.local scripts/import-following.ts <username>
 *
 *   Twitter:
 *     npx tsx --env-file=.env.local scripts/import-following.ts <username> --platform twitter
 *
 *   LinkedIn (keyword search, not following list):
 *     npx tsx --env-file=.env.local scripts/import-following.ts "online business coach" --platform linkedin
 *     npx tsx --env-file=.env.local scripts/import-following.ts "executive coach" --platform linkedin
 */
import { createClient } from "@supabase/supabase-js";
import {
  scrapeIgFollowing,
  scrapeTwitterFollowing,
  scrapeLinkedinCoaches,
  type SocialProfile,
  type IgProfile,
} from "../lib/apify";

const args = process.argv.slice(2);
const target = args[0]?.replace(/^@/, "");
const platformFlag = args.indexOf("--platform");
const platform = platformFlag !== -1 ? args[platformFlag + 1] : "instagram";
// Opt-in: enqueue research right after insert (throttled direct fetch). Off by
// default — new leads land as research_status "pending" and the throttled
// research-drain cron generates their openers, so nothing is stuck. Use
// --research to enrich immediately (incurs Claude + Apify cost per lead), and
// --url to point at the deployed app when no local dev server is running.
const wantResearch = args.includes("--research");
const urlFlag = args.indexOf("--url");
const researchBaseUrl =
  (urlFlag !== -1 ? args[urlFlag + 1] : undefined) ??
  process.env.NEXT_PUBLIC_BASE_URL ??
  "http://localhost:3000";

const MIN_FOLLOWERS = 10_000;
const MAX_FOLLOWERS = 150_000; // above this = likely already on FanBasis or too big to cold DM
const MAX_RESULTS   = 500;

if (!target) {
  console.error("Usage: npx tsx --env-file=.env.local scripts/import-following.ts <username|keyword> [--platform instagram|twitter|linkedin]");
  process.exit(1);
}

function toSocialProfile(p: IgProfile): SocialProfile {
  return {
    username:      p.username,
    fullName:      p.fullName,
    bio:           p.bio,
    followerCount: p.followerCount,
    profileUrl:    p.profileUrl,
    externalUrl:   p.externalUrl,
    isVerified:    p.isVerified,
    platform:      "instagram",
  };
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // Stamp new leads with the org, or they're invisible in the org-scoped
  // dashboard (scopeLeadsQuery filters by org_id; a null org = hidden in the UI).
  const { data: orgRow } = await supabase.from("orgs").select("id").limit(1).maybeSingle();
  const orgId = (orgRow?.id as string | undefined) ?? null;

  console.log(`\nPlatform: ${platform} | Target: ${target}\n`);

  let profiles: SocialProfile[] = [];

  if (platform === "instagram") {
    const igProfiles = await scrapeIgFollowing(target, { minFollowers: MIN_FOLLOWERS, maxResults: MAX_RESULTS });
    profiles = igProfiles.map(toSocialProfile).filter((p) => p.followerCount <= MAX_FOLLOWERS);

  } else if (platform === "twitter") {
    profiles = (await scrapeTwitterFollowing(target, { minFollowers: MIN_FOLLOWERS, maxResults: MAX_RESULTS }))
      .filter((p) => p.followerCount <= MAX_FOLLOWERS);

  } else if (platform === "linkedin") {
    profiles = await scrapeLinkedinCoaches(target, { maxResults: MAX_RESULTS });

  } else {
    console.error(`Unknown platform: ${platform}. Use instagram, twitter, or linkedin.`);
    process.exit(1);
  }

  console.log(`\nFound ${profiles.length} coach profiles (${MIN_FOLLOWERS.toLocaleString()}–${MAX_FOLLOWERS.toLocaleString()} followers)`);

  if (profiles.length === 0) {
    console.log("No matches. Try a different seed account or search keyword.");
    return;
  }

  console.log("\nTop matches:");
  profiles.slice(0, 10).forEach((p) =>
    console.log(`  @${p.username.padEnd(28)} ${String(p.followerCount.toLocaleString()).padStart(9)} followers — ${p.bio.slice(0, 55)}`)
  );

  const platformTag = platform === "linkedin" ? `linkedin_search` : `${target}_following`;

  const leads = profiles.map((p) => ({
    name:             p.fullName || p.username,
    ig_username:      platform === "instagram" ? p.username : null,
    ig_profile_url:   platform === "instagram" ? p.profileUrl : null,
    twitter_username: platform === "twitter"   ? p.username : null,
    linkedin_url:     platform === "linkedin"  ? p.profileUrl : null,
    bio:              p.bio,
    external_url:     p.externalUrl ?? null,
    follower_count:   p.followerCount,
    source:           platform === "instagram" ? "IG" : "Manual",
    mode:             "sales" as const,
    org_id:           orgId,
    stage:            "New",
    tags:             [platformTag, "coach", platform],
    research_status:  "pending",
    notes:            platform === "twitter"  ? `Twitter: @${p.username} | ${p.profileUrl}` :
                      platform === "linkedin" ? `LinkedIn: ${p.profileUrl}` : null,
  }));

  // Dedup by platform-specific unique identifier before every insert
  let newLeads = leads;

  if (platform === "instagram") {
    const usernames = leads.map((l) => l.ig_username).filter(Boolean) as string[];
    const { data: existing } = await supabase
      .from("leads").select("ig_username").in("ig_username", usernames);
    const seen = new Set((existing ?? []).map((r) => r.ig_username));
    newLeads = leads.filter((l) => !seen.has(l.ig_username));

  } else if (platform === "twitter") {
    const handles = leads.map((l) => l.twitter_username).filter(Boolean) as string[];
    const { data: existing } = await supabase
      .from("leads").select("twitter_username").in("twitter_username", handles);
    const seen = new Set((existing ?? []).map((r) => r.twitter_username));
    newLeads = leads.filter((l) => !seen.has(l.twitter_username));

  } else if (platform === "linkedin") {
    const urls = leads.map((l) => l.linkedin_url).filter(Boolean) as string[];
    const { data: existing } = await supabase
      .from("leads").select("linkedin_url").in("linkedin_url", urls);
    const seen = new Set((existing ?? []).map((r) => r.linkedin_url));
    newLeads = leads.filter((l) => !seen.has(l.linkedin_url));
  }

  if (newLeads.length === 0) {
    console.log("\nAll leads already exist in Supabase — nothing to import.");
    return;
  }

  // Leads land pooled (no owner_id) and research_status "pending" so any rep can
  // work them and the drain can enrich them.
  const { data: inserted, error } = await supabase.from("leads").insert(newLeads).select("id");

  if (error) {
    console.error("\nSupabase error:", error.message);
    process.exit(1);
  }

  console.log(`\n✓ Imported ${newLeads.length} new leads (${leads.length - newLeads.length} already existed)`);
  console.log(`  Tagged: ${platformTag}, coach, ${platform}`);

  const insertedIds = (inserted ?? []).map((r) => r.id as string);
  if (wantResearch && insertedIds.length) {
    await enqueueResearchForLeads(insertedIds);
  } else if (insertedIds.length) {
    console.log(
      `\n  ${insertedIds.length} leads are research_status "pending" — the research-drain cron will\n` +
      `  generate their openers. Re-run with --research (and optionally --url <deployedUrl>)\n` +
      `  to enrich them now (incurs Claude + Apify cost per lead).`
    );
  }
}

// Throttled, best-effort direct research enqueue. Concurrency 3 mirrors the
// drain; research-lead short-circuits on already-complete leads. Never throws.
async function enqueueResearchForLeads(ids: string[]) {
  const CONCURRENCY = 3;
  console.log(`\nEnqueuing research for ${ids.length} leads via ${researchBaseUrl} (concurrency ${CONCURRENCY})...`);
  let done = 0;
  let failed = 0;
  const queue = [...ids];
  async function worker() {
    while (queue.length) {
      const id = queue.shift()!;
      try {
        const res = await fetch(`${researchBaseUrl}/api/ai/research-lead`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: id }),
        });
        if (!res.ok) failed++;
      } catch {
        failed++;
      }
      done++;
      if (done % 25 === 0 || done === ids.length) console.log(`  research ${done}/${ids.length} (${failed} failed)`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, ids.length) }, worker));
  console.log(`✓ Research enqueue complete: ${done - failed} ok, ${failed} failed.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
