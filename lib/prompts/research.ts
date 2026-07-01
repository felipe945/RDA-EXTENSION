import type { HandleCandidate } from "@/lib/research/crossPlatform";

export interface ResearchProfile {
  username: string;
  bio: string;
  followerCount: number;
  profileUrl: string;
  // Apify-enriched fields (optional — fall back gracefully if unavailable)
  fullName?: string;
  followingCount?: number;
  postCount?: number;
  isVerified?: boolean;
  category?: string | null;
  externalUrl?: string | null;
  engagementRate?: number | null;
  // Cross-platform candidates found via website scrape + Google search
  crossPlatformCandidates?: HandleCandidate[];
}

export interface ResearchResult {
  estimatedGmv: number;
  fitScore: number;
  fitReason: string;
  stackDetected: string[];
  summary: string;
  persona: string;
  inferredHandles: {
    youtube: string | null;
    twitter: string | null;
    website: string | null;
    email: string | null;
  };
  openers: {
    ig: string;
    email: { subject: string; body: string };
    linkedin: string;
    sms: string;
  };
  suggestedOpener: string; // kept for backward compat — same as openers.ig
  alreadyCustomer: boolean;
}

export function buildResearchPrompt(profile: ResearchProfile): {
  system: string;
  user: string;
} {
  const system = `You are a sales researcher at FanBasis — a creator monetization platform with $1B+/year GMV, 20,000+ active sellers, and a proven 38% top-line lift from ClarityPay BNPL (buy now, pay later). Your job is to evaluate Instagram creators as potential FanBasis customers and arm Felipe (a closer) with everything he needs to reach out across multiple channels.

FanBasis is the right fit for creators who:
- Already sell digital products, physical merch, courses, memberships, or coaching
- Have an engaged audience (10k+ followers meaningful, 50k+ strong)
- Use platforms like Shopify, Kajabi, Gumroad, Teachable, Stan Store, or similar
- Experience friction at checkout (abandoned carts, payment declines, high-ticket hesitation)
- Are in niches with proven commerce: fitness, beauty, fashion, business/finance, gaming, cooking, parenting, wellness, music

SCORING RULES (apply strictly):
- followerCount < 1,000 → fitScore MUST be < 30
- followerCount 1,000–9,999 → fitScore cap 55
- followerCount 10,000–49,999 → fitScore cap 75
- followerCount 50,000+ → fitScore up to 100 if signals align
- engagementRate > 5% → +10 to fitScore
- Bio mentions active selling (Shopify, product page, course link) → +15
- Bio mentions coaching or consulting → +10
- External URL is a storefront → +10
- Bio is empty or generic → fitScore max 40
- Verified account → +5

PERSONA SEGMENTS — pick the single best match:
- "young creator (18-24)" — lifestyle, gaming, fashion, trending content
- "creator (25-34)" — established content, multiple revenue streams
- "coach/consultant" — B2B, business advice, results-based offers
- "course creator" — educational content, structured programs
- "ecommerce seller" — physical or digital products, brand-focused
- "mom/family niche" — parenting, home, family content with audience trust
- "fitness/wellness" — health, workout programs, supplements
- "info marketer" — high-ticket offers, sales-focused messaging
- "other" — doesn't fit neatly above

OPENER RULES — each opener must feel human and conversational, not like a sales pitch:
- IG DM: follow the EXACT 3-part structure below. Max ~250 chars total.
  PART 1 — INTRO + PERSONALIZATION: "Hey [FirstName] — on the partnerships team at FanBasis." + one specific hook about their actual offer/niche/situation (not generic). Use real details from the bio.
  PART 2 — VALUE: Explain what FanBasis does in 1-2 lines. Always name FanBasis. Cover 2 of: lower fees, BNPL at checkout, lead qualifier. Choose based on their persona (high-ticket coach → qualifier + BNPL; ecom → fees + BNPL; course creator → fees + BNPL lift).
  PART 3 — CTA: One low-commitment ask. "Happy to show you what this looks like with your numbers — do you have 45 min this week?" or similar. Never say "hop on a call."
  Tone: warm, direct, peer-to-peer. Never say "love your content" or "amazing work." No condescension.
- Email: subject line under 50 chars, body under 100 words, specific hook in first sentence
- LinkedIn: professional but not stiff, reference their business specifically, under 150 chars
- SMS: ultra short, under 80 chars, feels like a text from someone they know
- Adjust tone per persona: young creator = casual/slang OK; coach/consultant = peer-to-peer business tone; info marketer = straight to the point

You are NOT writing marketing copy. Be direct, specific, and concrete. Never use generic phrases like "love your content" or "amazing work". If data is thin, say so explicitly.`;

  const followerLabel = profile.followerCount === 0
    ? "unknown"
    : profile.followerCount.toLocaleString();

  const lines: string[] = [
    `Username: @${profile.username}`,
    `Profile URL: ${profile.profileUrl}`,
    `Bio: ${profile.bio || "(empty)"}`,
    `Followers: ${followerLabel}`,
  ];

  if (profile.fullName)       lines.push(`Full name: ${profile.fullName}`);
  if (profile.followingCount) lines.push(`Following: ${profile.followingCount.toLocaleString()}`);
  if (profile.postCount)      lines.push(`Posts: ${profile.postCount}`);
  if (profile.isVerified)     lines.push(`Verified: yes`);
  if (profile.category)       lines.push(`IG Category: ${profile.category}`);
  if (profile.externalUrl)    lines.push(`External URL: ${profile.externalUrl}`);
  if (profile.engagementRate != null) lines.push(`Engagement rate: ${profile.engagementRate}%`);

  // Build cross-platform candidates block
  let candidatesBlock = "";
  if (profile.crossPlatformCandidates && profile.crossPlatformCandidates.length > 0) {
    const bySource = {
      website: profile.crossPlatformCandidates.filter(c => c.source === "website_scrape"),
      google:  profile.crossPlatformCandidates.filter(c => c.source === "google_search"),
    };

    const lines2: string[] = ["\nCross-platform profiles found by automated search:"];

    if (bySource.website.length > 0) {
      lines2.push("FROM THEIR WEBSITE (high confidence — they linked these themselves):");
      for (const c of bySource.website) {
        lines2.push(`  [${c.platform.toUpperCase()}] ${c.url} — handle: ${c.handle}`);
      }
    }

    if (bySource.google.length > 0) {
      lines2.push("FROM GOOGLE SEARCH (verify these are the same person):");
      for (const c of bySource.google) {
        const snippet = c.description ? ` — "${c.description.slice(0, 120)}"` : "";
        lines2.push(`  [${c.platform.toUpperCase()}] ${c.url} — "${c.title}"${snippet}`);
      }
    }

    lines2.push(`
VERIFICATION INSTRUCTIONS:
- For each candidate above, score 0-100: is this genuinely @${profile.username}'s account?
- Website-sourced links: include if score >= 60 (they linked it themselves)
- Google-sourced links: include if score >= 75 (cross-check name, bio, niche, follower scale)
- If multiple candidates for same platform, pick the highest-confidence one only
- If score < threshold, set that platform to null in inferredHandles`);

    candidatesBlock = lines2.join("\n");
  } else {
    candidatesBlock = `\nNo cross-platform profiles were found via automated search. Use your knowledge of common username patterns and bio signals to infer likely handles, but mark confidence lower. Set platforms to null if you cannot make a reasonable inference.`;
  }

  const user = `Analyze this Instagram profile and return ONLY a valid JSON object — no markdown, no explanation, no code fences.

Profile data:
${lines.map(l => `- ${l}`).join("\n")}
${candidatesBlock}

Return this exact JSON shape:
{
  "estimatedGmv": <number: estimated monthly USD revenue from audience monetization, 0 if no signals>,
  "fitScore": <number 0-100: per scoring rules above>,
  "fitReason": "<1-2 sentences: specific reason for this score — name the exact signals you saw>",
  "stackDetected": ["<platform names from bio/URL, e.g. Shopify, Linktree, Kajabi, Stan Store>"],
  "summary": "<2-3 sentences: sales brief Felipe reads in 10 seconds — what do they sell, how big is their business, what's the FanBasis angle>",
  "persona": "<single best-match persona segment from the list above>",
  "inferredHandles": {
    "youtube": "<YouTube channel URL or handle if inferable from username/bio/external URL, else null>",
    "twitter": "<Twitter/X handle if inferable, else null>",
    "website": "<personal or business website if different from externalUrl, else null>",
    "email": "<likely email pattern e.g. hello@theirdomain.com if domain is known, else null>"
  },
  "openers": {
    "ig": "<IG DM following 3-part structure: (1) 'Hey [FirstName] — on the partnerships team at FanBasis.' + specific hook about their offer/niche, (2) what FanBasis does: lower fees + BNPL + qualifier, tailored to persona, (3) low-commitment CTA. Max 250 chars total. No generic phrases.>",
    "email": {
      "subject": "<email subject line, under 50 chars, specific hook>",
      "body": "<email body, under 100 words, first sentence hooks on something specific about them, ends with a clear single question>"
    },
    "linkedin": "<LinkedIn connection note, under 150 chars, peer-to-peer business tone>",
    "sms": "<SMS text, under 80 chars, feels like a text from someone they know>"
  },
  "suggestedOpener": "<same as openers.ig — kept for compatibility>",
  "alreadyCustomer": false
}

Be specific. Use real details from the bio. Do not pad or hedge.`;

  return { system, user };
}

// JSON Schema for Claude tool_use — guarantees structured output with no parsing needed
export const RESEARCH_TOOL_SCHEMA = {
  type: "object" as const,
  required: ["estimatedGmv", "fitScore", "fitReason", "stackDetected", "summary", "persona", "inferredHandles", "openers", "suggestedOpener", "alreadyCustomer"],
  properties: {
    estimatedGmv:   { type: "number",  description: "Estimated monthly USD revenue, 0 if no signals" },
    fitScore:       { type: "number",  description: "0-100 fit score per scoring rules" },
    fitReason:      { type: "string",  description: "1-2 sentences explaining the score with specific signals" },
    stackDetected:  { type: "array",   items: { type: "string" }, description: "Platform names from bio/URL" },
    summary:        { type: "string",  description: "2-3 sentence sales brief" },
    persona:        { type: "string",  description: "Single best-match persona segment" },
    inferredHandles: {
      type: "object",
      properties: {
        youtube: { type: ["string", "null"] },
        twitter: { type: ["string", "null"] },
        website: { type: ["string", "null"] },
        email:   { type: ["string", "null"] },
      },
      required: ["youtube", "twitter", "website", "email"],
    },
    openers: {
      type: "object",
      properties: {
        ig:       { type: "string" },
        linkedin: { type: "string" },
        sms:      { type: "string" },
        email: {
          type: "object",
          properties: {
            subject: { type: "string" },
            body:    { type: "string" },
          },
          required: ["subject", "body"],
        },
      },
      required: ["ig", "email", "linkedin", "sms"],
    },
    suggestedOpener: { type: "string", description: "Same as openers.ig — backward compat" },
    alreadyCustomer: { type: "boolean" },
  },
};
