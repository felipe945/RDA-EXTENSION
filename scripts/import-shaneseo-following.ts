/**
 * One-time script — scrapes @shaneseo's following list via Apify,
 * filters for coaches with 10k+ followers, and upserts them as leads.
 *
 * Run: npx tsx scripts/import-shaneseo-following.ts
 */
import { createClient } from "@supabase/supabase-js";
import { scrapeIgFollowing } from "../lib/apify";

const TARGET_USERNAME = "shaneseo";
const MIN_FOLLOWERS = 10_000;
const MAX_RESULTS = 500;

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  console.log(`Scraping @${TARGET_USERNAME} following list (two-pass, ~5-8 min for 500 accounts)...`);

  const profiles = await scrapeIgFollowing(TARGET_USERNAME, {
    minFollowers: MIN_FOLLOWERS,
    maxResults: MAX_RESULTS,
  });

  console.log(`\nFound ${profiles.length} coach profiles with ${MIN_FOLLOWERS.toLocaleString()}+ followers`);

  if (profiles.length === 0) {
    console.log("No matches. Try expanding COACH_KEYWORDS in lib/apify.ts or lowering MIN_FOLLOWERS.");
    return;
  }

  console.log("\nTop matches:");
  profiles.slice(0, 10).forEach((p) =>
    console.log(`  @${p.username.padEnd(25)} ${String(p.followerCount.toLocaleString()).padStart(8)} followers — ${p.bio.slice(0, 60)}`)
  );

  const leads = profiles.map((p) => ({
    name: p.fullName || p.username,
    ig_username: p.username,
    ig_profile_url: p.profileUrl,
    bio: p.bio,
    follower_count: p.followerCount,
    source: "IG" as const,
    mode: "sales" as const,
    stage: "New",
    tags: ["shaneseo_following", "coach"],
    research_status: "pending",
  }));

  // Filter out ig_usernames already in the DB
  const usernamesToInsert = leads.map((l) => l.ig_username);
  const { data: existing } = await supabase
    .from("leads")
    .select("ig_username")
    .in("ig_username", usernamesToInsert);

  const existingSet = new Set((existing ?? []).map((r) => r.ig_username));
  const newLeads = leads.filter((l) => !existingSet.has(l.ig_username));

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
  console.log("All leads set to research_status=pending — research pipeline will auto-enrich them.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
