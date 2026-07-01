const ECOMMERCE_KEYWORDS = [
  "store",
  "shop",
  "course",
  "coaching",
  "merch",
  "brand",
  "creator",
];

interface ResearchCache {
  fitScore?: number;
  estimatedGmv?: number;
  stackDetected?: unknown;
  alreadyCustomer?: boolean;
  [key: string]: unknown;
}

interface ScoringInput {
  bio?: string;
  followerCount?: number;
  externalUrl?: string;
  researchCache?: Record<string, unknown>;
}

export function scoreLead(profile: ScoringInput): number {
  // AI research score is the source of truth — don't overwrite with heuristic
  const cache = (profile.researchCache ?? {}) as ResearchCache;
  const aiFitScore = typeof cache.fitScore === "number" ? cache.fitScore : null;
  if (aiFitScore !== null) return aiFitScore;

  let score = 0;

  // Follower count scoring
  const followers = profile.followerCount ?? 0;
  if (followers >= 100_000) {
    score += 30;
  } else if (followers >= 10_000) {
    score += 20;
  } else if (followers >= 1_000) {
    score += 10;
  }

  // Bio keyword scoring
  const bio = (profile.bio ?? "").toLowerCase();
  const hasEcommerceKeyword = ECOMMERCE_KEYWORDS.some((kw) => bio.includes(kw));
  if (hasEcommerceKeyword) {
    score += 15;
  }

  // Link-in-bio scoring
  if (profile.externalUrl) {
    score += 15;
  }

  // Research cache scoring
  const gmv = cache.estimatedGmv;
  if (typeof gmv === "number") {
    if (gmv >= 10_000) {
      score += 20;
    } else if (gmv >= 1_000) {
      score += 10;
    }
  }

  if (cache.stackDetected !== undefined && cache.stackDetected !== null) {
    score += 10;
  }

  // Existing customer penalty
  if (cache.alreadyCustomer === true) {
    score -= 50;
  }

  return score;
}
