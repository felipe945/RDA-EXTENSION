// lib/research/crossPlatform.ts
// Deep cross-platform profile search: website scrape → Google search → Gemini verify

export interface HandleCandidate {
  platform: "youtube" | "twitter" | "linkedin" | "tiktok" | "website" | "email";
  url: string;
  handle: string;
  title?: string;       // page title or search result title
  description?: string; // snippet from Google or meta description from site
  source: "website_scrape" | "google_search";
}

// ── Tier 1: Scrape their website / Linktree / Beacons ────────────────────────
// Creators almost always link every social from their link-in-bio page.
// This is free, fast, and ~95% accurate when it works.

const LINK_PATTERNS: {
  platform: HandleCandidate["platform"];
  regex: RegExp;
}[] = [
  { platform: "youtube",  regex: /https?:\/\/(?:www\.)?youtube\.com\/(?:channel\/[\w-]+|@[\w.-]+|c\/[\w-]+)/gi },
  { platform: "twitter",  regex: /https?:\/\/(?:www\.)?(?:twitter\.com|x\.com)\/(?!intent|share|home|search|hashtag)[\w]+/gi },
  { platform: "linkedin", regex: /https?:\/\/(?:www\.)?linkedin\.com\/in\/[\w%-]+/gi },
  { platform: "tiktok",   regex: /https?:\/\/(?:www\.)?tiktok\.com\/@[\w.]+/gi },
  { platform: "email",    regex: /mailto:([\w.+-]+@[\w-]+\.[\w.]+)/gi },
];

export async function scrapeWebsiteHandles(url: string): Promise<HandleCandidate[]> {
  if (!url) return [];
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/120 Safari/537.36" },
      signal: AbortSignal.timeout(9000),
      redirect: "follow",
    });
    if (!res.ok) return [];
    const html = await res.text();
    const found: HandleCandidate[] = [];
    const seen = new Set<string>();

    for (const { platform, regex } of LINK_PATTERNS) {
      const matches = [...html.matchAll(regex)];
      for (const match of matches) {
        const raw = match[0];
        // For email, match[1] is the address; for others raw is the URL
        const normalized = platform === "email" ? `mailto:${match[1]}` : raw.toLowerCase().split("?")[0];
        if (seen.has(normalized)) continue;
        seen.add(normalized);

        const handle = platform === "email"
          ? match[1]
          : raw.replace(/^https?:\/\/(www\.)?/, "").split("/").filter(Boolean).pop() ?? raw;

        found.push({ platform, url: raw, handle, source: "website_scrape" });
      }
    }

    return found;
  } catch {
    return [];
  }
}

// ── Tier 2: Apify Google Search ───────────────────────────────────────────────
// Run targeted queries to find profiles the website didn't list.

interface GoogleItem {
  organicResults?: Array<{ title?: string; url?: string; description?: string }>;
}

export async function googleSearchHandles(
  username: string,
  fullName: string | undefined,
  token: string
): Promise<HandleCandidate[]> {
  const nameQ = fullName ? `"${fullName}"` : `"${username}"`;

  const queries = [
    `${nameQ} youtube channel creator -site:instagram.com`,
    `${nameQ} site:linkedin.com/in`,
    `"${username}" (twitter.com OR x.com) -site:instagram.com`,
  ];

  try {
    const res = await fetch(
      `https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${token}&timeout=50`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ queries, maxPagesPerQuery: 1, resultsPerPage: 5 }),
        signal: AbortSignal.timeout(60000),
      }
    );
    if (!res.ok) return [];

    const items = (await res.json()) as GoogleItem[];
    const found: HandleCandidate[] = [];
    const seen = new Set<string>();

    for (const item of items) {
      for (const r of item.organicResults ?? []) {
        if (!r.url) continue;
        const url = r.url;
        const lower = url.toLowerCase();
        if (seen.has(url)) continue;
        seen.add(url);

        let platform: HandleCandidate["platform"] | null = null;
        if (lower.includes("youtube.com/@") || lower.includes("youtube.com/channel") || lower.includes("youtube.com/c/")) {
          platform = "youtube";
        } else if (lower.includes("linkedin.com/in/")) {
          platform = "linkedin";
        } else if (lower.includes("twitter.com/") || lower.includes("x.com/")) {
          platform = "twitter";
        } else if (lower.includes("tiktok.com/@")) {
          platform = "tiktok";
        }

        if (!platform) continue;

        const handle = url.replace(/^https?:\/\/(www\.)?/, "").split("/").filter(Boolean).pop() ?? url;
        found.push({
          platform,
          url,
          handle,
          title: r.title ?? undefined,
          description: r.description ?? undefined,
          source: "google_search",
        });
      }
    }

    return found;
  } catch {
    return [];
  }
}

// ── Orchestrator ──────────────────────────────────────────────────────────────
// Runs both tiers in parallel, deduplicates by URL.
// Website scrape runs even on free Apify (it's a plain fetch).
// Google search only runs if APIFY_TOKEN is set.

export async function findCrossPlatformHandles(params: {
  username: string;
  fullName?: string;
  externalUrl?: string | null;
  apifyToken?: string;
}): Promise<HandleCandidate[]> {
  const { username, fullName, externalUrl, apifyToken } = params;

  const [websiteHandles, googleHandles] = await Promise.all([
    externalUrl ? scrapeWebsiteHandles(externalUrl) : Promise.resolve([]),
    apifyToken ? googleSearchHandles(username, fullName, apifyToken) : Promise.resolve([]),
  ]);

  // Merge — website scrape wins on duplicates (higher confidence)
  const seen = new Set<string>();
  const all: HandleCandidate[] = [];

  for (const h of [...websiteHandles, ...googleHandles]) {
    const key = h.url.toLowerCase().split("?")[0];
    if (!seen.has(key)) {
      seen.add(key);
      all.push(h);
    }
  }

  return all;
}
