async function apifyFetch(url: string, init: RequestInit, retries = 3): Promise<Response> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await fetch(url, init);
    } catch (err) {
      if (attempt === retries) throw err;
      const wait = attempt * 5000;
      console.warn(`  [apify] fetch error (attempt ${attempt}/${retries}), retrying in ${wait / 1000}s...`, (err as Error).message);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
  throw new Error("unreachable");
}

// Start an Apify actor run, poll until done, return dataset items
async function apifyRunAsync(token: string, actorId: string, input: unknown): Promise<unknown[]> {
  // Start the run
  const startRes = await apifyFetch(
    `https://api.apify.com/v2/acts/${actorId}/runs?token=${token}`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input) }
  );
  if (!startRes.ok) throw new Error(`[apify] HTTP ${startRes.status} starting ${actorId}`);
  const startData = (await startRes.json()) as { data: { id: string; defaultDatasetId: string } };
  const { id: runId, defaultDatasetId } = startData.data;

  // Poll until finished
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 10_000)); // wait 10s between polls
    const pollRes = await apifyFetch(
      `https://api.apify.com/v2/acts/${actorId}/runs/${runId}?token=${token}`,
      { method: "GET" }
    );
    if (!pollRes.ok) continue;
    const { data } = (await pollRes.json()) as { data: { status: string } };
    if (data.status === "SUCCEEDED") break;
    if (data.status === "FAILED" || data.status === "ABORTED") {
      throw new Error(`[apify] Run ${runId} ended with status ${data.status}`);
    }
    process.stdout.write(".");
  }
  process.stdout.write("\n");

  // Fetch dataset items
  const itemsRes = await apifyFetch(
    `https://api.apify.com/v2/datasets/${defaultDatasetId}/items?token=${token}&limit=1000`,
    { method: "GET" }
  );
  if (!itemsRes.ok) throw new Error(`[apify] HTTP ${itemsRes.status} fetching dataset ${defaultDatasetId}`);
  return (await itemsRes.json()) as unknown[];
}

const COACH_KEYWORDS = [
  // Core coaching
  "coach", "coaching", "mentor", "mentorship",
  // Teaching / education
  "teach", "teaching", "teacher", "educator", "course", "courses",
  // Programs & offers
  "program", "masterclass", "bootcamp", "workshop", "academy", "mastermind",
  "curriculum", "enroll", "enrollment",
  // Consulting & advisory
  "consultant", "consulting", "strategist", "advisor",
  // Training
  "trainer", "training",
  // DM-to-buy signals (creators who sell via DMs)
  "dm me", "dm \"", "dm '", "comment below", "link in bio",
  "apply now", "applications open", "spots open", "limited spots",
  // Outcome language coaches use
  "helping", "i help", "we help", "transform", "transformation",
  "scale your", "grow your", "build your", "launch your",
  "6 figure", "7 figure", "multiple 6", "high ticket",
  // Client/results language
  "clients", "client results", "student results",
  // Online business signals
  "online business", "freedom", "passive income", "creator economy",
  // SMMA / agency
  "smma", "agency owner", "digital agency", "marketing agency",
  "social media marketing", "media buyer", "media buying",
  // Lead gen / outreach
  "lead gen", "lead generation", "appointment setting", "cold outreach",
  "cold email", "cold dm", "client acquisition",
  // Funnels / ads
  "funnel", "funnels", "paid ads", "facebook ads", "meta ads", "google ads",
  "adspend", "ad spend",
  // Sales roles
  "closer", "setter", "sales rep", "high ticket sales", "remote closer",
  // Retainer / scaling language
  "retainer", "scaling", "8 figure", "9 figure",
];

export interface IgProfile {
  username: string;
  fullName: string;
  bio: string;
  followerCount: number;
  followingCount: number;
  postCount: number;
  isVerified: boolean;
  category: string | null;
  profileUrl: string;
  externalUrl: string | null;
  engagementRate: number | null; // (avgLikes + avgComments) / followers * 100
}

export async function scrapeIgFollowing(
  targetUsername: string,
  options: { minFollowers?: number; maxResults?: number } = {}
): Promise<IgProfile[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("[apify] APIFY_TOKEN not set");

  const { minFollowers = 10000, maxResults = 500 } = options;

  // Pass 1: get following usernames (sync endpoint, up to 300s)
  const followingRes = await apifyFetch(
    `https://api.apify.com/v2/acts/datadoping~instagram-following-scraper/run-sync-get-dataset-items?token=${token}&timeout=300`,
    { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usernames: [targetUsername], max_count: maxResults }) }
  );
  if (!followingRes.ok) {
    const body = await followingRes.text();
    throw new Error(`[apify] HTTP ${followingRes.status} fetching following for @${targetUsername}: ${body.slice(0, 200)}`);
  }
  const followingItems = (await followingRes.json()) as Record<string, unknown>[];
  const usernames = followingItems
    .filter((item) => !item.is_private)
    .map((item) => item.username as string)
    .filter(Boolean);

  console.log(`  → @${targetUsername} follows ${usernames.length} public accounts`);
  if (usernames.length === 0) return [];

  // Pass 2: batch-fetch full profiles (bio + follower count)
  const BATCH = 100;
  const allProfiles: IgProfile[] = [];

  for (let i = 0; i < usernames.length; i += BATCH) {
    const batch = usernames.slice(i, i + BATCH);
    console.log(`  → Fetching profiles batch ${Math.floor(i / BATCH) + 1}/${Math.ceil(usernames.length / BATCH)} (${batch.length} accounts)...`);

    const profileRes = await apifyFetch(
      `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=${token}&timeout=180`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ usernames: batch }) }
    );

    if (!profileRes.ok) {
      console.warn(`  [apify] HTTP ${profileRes.status} on batch ${i}–${i + BATCH}, skipping`);
      continue;
    }

    const items = (await profileRes.json()) as Record<string, unknown>[];
    const filtered = items
      .filter((item) => {
        const followers = (item.followersCount as number) ?? 0;
        const bio = ((item.biography as string) ?? "").toLowerCase();
        const category = ((item.businessCategoryName as string) ?? "").toLowerCase();
        const isCoach = COACH_KEYWORDS.some((kw) => bio.includes(kw) || category.includes(kw));
        return followers >= minFollowers && isCoach;
      })
      .map((item) => {
        const username = (item.username as string) ?? "";
        let engagementRate: number | null = null;
        const posts = item.latestPosts as Array<Record<string, unknown>> | undefined;
        const followers = (item.followersCount as number) ?? 0;
        if (Array.isArray(posts) && posts.length > 0 && followers > 0) {
          const total = posts.reduce(
            (s, p) => s + ((p.likesCount as number) ?? 0) + ((p.commentsCount as number) ?? 0),
            0
          );
          engagementRate = parseFloat(((total / posts.length / followers) * 100).toFixed(2));
        }
        return {
          username,
          fullName:      (item.fullName as string)             ?? "",
          bio:           (item.biography as string)            ?? "",
          followerCount: followers,
          followingCount:(item.followsCount as number)         ?? 0,
          postCount:     (item.postsCount as number)           ?? 0,
          isVerified:    (item.verified as boolean)            ?? false,
          category:      (item.businessCategoryName as string) ?? null,
          profileUrl:    (item.url as string)                  ?? `https://www.instagram.com/${username}/`,
          externalUrl:   (item.externalUrl as string)          ?? null,
          engagementRate,
        } satisfies IgProfile;
      });

    allProfiles.push(...filtered);
    console.log(`  → ${filtered.length} coaches found in this batch (${allProfiles.length} total so far)`);
  }

  return allProfiles;
}

// ─── Twitter ─────────────────────────────────────────────────────────────────

export interface SocialProfile {
  username: string;
  fullName: string;
  bio: string;
  followerCount: number;
  profileUrl: string;
  externalUrl: string | null;
  isVerified: boolean;
  platform: "instagram" | "twitter" | "linkedin";
}

export async function scrapeTwitterFollowing(
  targetUsername: string,
  options: { minFollowers?: number; maxResults?: number } = {}
): Promise<SocialProfile[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("[apify] APIFY_TOKEN not set");

  const { minFollowers = 10000, maxResults = 500 } = options;

  const res = await apifyFetch(
    `https://api.apify.com/v2/acts/data-slayer~twitter-followings/run-sync-get-dataset-items?token=${token}&timeout=300`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username: targetUsername, maxItems: maxResults }),
    }
  );

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`[apify] HTTP ${res.status} scraping Twitter following for @${targetUsername}: ${body.slice(0, 300)}`);
  }

  const items = (await res.json()) as Record<string, unknown>[];
  if (!Array.isArray(items)) return [];

  console.log(`  → @${targetUsername} Twitter following: ${items.length} accounts returned`);

  return items
    .filter((item) => {
      // actor may use followers, followersCount, or followers_count
      const followers =
        (item.followers as number) ??
        (item.followersCount as number) ??
        (item.followers_count as number) ?? 0;
      const bio = ((item.description as string) ?? (item.bio as string) ?? "").toLowerCase();
      const isCoach = COACH_KEYWORDS.some((kw) => bio.includes(kw));
      return followers >= minFollowers && isCoach;
    })
    .map((item) => {
      const handle = (item.username as string) ?? (item.screen_name as string) ?? "";
      const followers =
        (item.followers as number) ??
        (item.followersCount as number) ??
        (item.followers_count as number) ?? 0;
      return {
        username: handle,
        fullName: (item.name as string) ?? (item.displayName as string) ?? "",
        bio: (item.description as string) ?? (item.bio as string) ?? "",
        followerCount: followers,
        profileUrl: `https://twitter.com/${handle}`,
        externalUrl: (item.url as string) ?? (item.externalUrl as string) ?? null,
        isVerified: (item.isVerified as boolean) ?? (item.verified as boolean) ?? false,
        platform: "twitter" as const,
      };
    });
}

// ─── LinkedIn ─────────────────────────────────────────────────────────────────
// Uses people search (keyword → profiles) rather than a following list,
// since LinkedIn personal following lists require heavy auth.

const LINKEDIN_COACH_QUERIES = [
  "online business coach",
  "executive coach",
  "life coach",
  "mindset coach",
  "high performance coach",
];

export async function scrapeLinkedinCoaches(
  searchKeyword: string,
  options: { maxResults?: number } = {}
): Promise<SocialProfile[]> {
  const token = process.env.APIFY_TOKEN;
  if (!token) throw new Error("[apify] APIFY_TOKEN not set");
  const liAt = process.env.LINKEDIN_LI_AT;

  const { maxResults = 100 } = options;

  const searchUrl = `https://www.linkedin.com/search/results/people/?keywords=${encodeURIComponent(searchKeyword)}&origin=GLOBAL_SEARCH_HEADER`;

  const body: Record<string, unknown> = {
    searchUrl,
    maxItems: maxResults,
  };
  if (liAt) body.cookie = liAt;

  const res = await apifyFetch(
    `https://api.apify.com/v2/acts/powerai~linkedin-peoples-search-scraper/run-sync-get-dataset-items?token=${token}&timeout=300`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`[apify] HTTP ${res.status} scraping LinkedIn for "${searchKeyword}": ${text.slice(0, 300)}`);
  }

  const items = (await res.json()) as Record<string, unknown>[];
  if (!Array.isArray(items)) return [];

  console.log(`  → LinkedIn search "${searchKeyword}": ${items.length} profiles returned`);

  return items.map((item) => {
    const profileUrl =
      (item.profileUrl as string) ??
      (item.url as string) ??
      (item.linkedinUrl as string) ?? "";
    const username = profileUrl.split("/in/")[1]?.replace(/\/$/, "") ?? profileUrl;
    return {
      username,
      fullName: (item.name as string) ?? (item.fullName as string) ?? "",
      bio: (item.headline as string) ?? (item.title as string) ?? (item.description as string) ?? "",
      followerCount: (item.connectionsCount as number) ?? (item.followers as number) ?? 0,
      profileUrl,
      externalUrl: null,
      isVerified: false,
      platform: "linkedin" as const,
    };
  });
}

export { LINKEDIN_COACH_QUERIES };

// ─── Instagram (single profile enrichment) ───────────────────────────────────

export async function fetchIgProfile(username: string): Promise<IgProfile | null> {
  const token = process.env.APIFY_TOKEN;
  if (!token) {
    console.warn("[apify] APIFY_TOKEN not set — skipping enrichment");
    return null;
  }

  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/apify~instagram-profile-scraper/run-sync-get-dataset-items?token=${token}&timeout=60`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ usernames: [username] }),
      }
    );

    if (!res.ok) {
      console.warn(`[apify] HTTP ${res.status} for @${username}`);
      return null;
    }

    const items = (await res.json()) as Record<string, unknown>[];
    if (!Array.isArray(items) || items.length === 0) return null;

    const item = items[0];

    // Calculate engagement rate from recent posts if available
    let engagementRate: number | null = null;
    const posts = item.latestPosts as Array<Record<string, unknown>> | undefined;
    const followers = (item.followersCount as number) ?? 0;
    if (Array.isArray(posts) && posts.length > 0 && followers > 0) {
      const totalEngagement = posts.reduce((sum, p) => {
        return sum + ((p.likesCount as number) ?? 0) + ((p.commentsCount as number) ?? 0);
      }, 0);
      engagementRate = parseFloat(((totalEngagement / posts.length / followers) * 100).toFixed(2));
    }

    return {
      username:      (item.username as string)              ?? username,
      fullName:      (item.fullName as string)              ?? "",
      bio:           (item.biography as string)             ?? "",
      followerCount: (item.followersCount as number)        ?? 0,
      followingCount:(item.followsCount as number)          ?? 0,
      postCount:     (item.postsCount as number)            ?? 0,
      isVerified:    (item.verified as boolean)             ?? false,
      category:      (item.businessCategoryName as string)  ?? null,
      profileUrl:    (item.url as string)                   ?? `https://www.instagram.com/${username}/`,
      externalUrl:   (item.externalUrl as string)           ?? null,
      engagementRate,
    };
  } catch (err) {
    console.error("[apify] fetchIgProfile error:", err);
    return null;
  }
}
