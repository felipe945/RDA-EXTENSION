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

  const { error } = await supabase.from("leads").insert(newLeads);

  if (error) {
    console.error("\nSupabase error:", error.message);
    process.exit(1);
  }

  console.log(`\n✓ Imported ${newLeads.length} new leads (${leads.length - newLeads.length} already existed)`);
  console.log(`  Tagged: ${platformTag}, coach, ${platform}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
