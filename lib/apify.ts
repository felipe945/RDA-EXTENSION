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
