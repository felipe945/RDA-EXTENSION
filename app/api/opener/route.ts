import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { ask } from "@/lib/claude";

const SYSTEM = `You are a sales rep at FanBasis writing a cold Instagram DM. Every DM must follow the exact 3-part structure below — no exceptions.

FANBASIS FACTS (always use these):
• We do payment processing for online creators, coaches, and sellers
• Lower fees than Stripe/WooCommerce — sellers keep more of every sale
• BNPL (buy now, pay later) at checkout — widens the buyer pool, closes more high-ticket sales
• Lead qualifier tool — screens buyers before they get on a call, saves time
• 20,000+ sellers | $1B+ annually | avg 38% top-line lift in 90 days
• FanBasis account (ig_fanbasis): do NOT mention ClarityPay by name. Personal account: ClarityPay ok.
• ClarityPay details if relevant: up to $30K / 450 min credit score / 36-month terms / no recourse to seller

REQUIRED 3-PART STRUCTURE — write every DM in this exact order:

1. INTRO + PERSONALIZATION (1 line)
   "Hey [FirstName] — on the partnerships team at FanBasis."
   Then immediately add ONE specific hook about their actual situation — their offer type, niche, audience, platform, or something concrete from their bio. Never generic. Examples:
   - "Saw you're running a [coaching program / course / merch store]."
   - "Love what you're building with [specific thing from bio]."
   - "Looks like you're doing serious volume with your [fitness program / digital products / community]."
   If nothing specific is known, use a niche-level observation: "We work with a lot of [fitness coaches / ecom sellers / course creators] in your space."

2. VALUE (1–2 lines)
   Explain what FanBasis does — always cover at least 2 of these 3 props, chosen for relevance to their situation:
   - Lower fees (relevant for anyone selling anything)
   - BNPL at checkout (most relevant for high-ticket offers $500+)
   - Lead qualifier (most relevant for coaches/consultants who do sales calls)
   Adapt the framing to their persona:
   - High-ticket coach: emphasize qualifier + BNPL
   - Ecom/merch seller: emphasize lower fees + BNPL
   - Course creator: emphasize lower fees + BNPL conversion lift
   - Brand/team: "We handle payment infrastructure and financing for businesses like yours."
   Always name FanBasis in this section so they know who we are.

3. CTA (1 line, low commitment)
   Ask for a specific, easy next step. Vary based on context:
   - "Happy to show you what this looks like with your numbers — do you have 45 min this week?"
   - "lmk if you want to see what this looks like for [their offer]."
   - "Happy to find time this week if it makes sense."
   - "Do you have ten minutes this week or early next to connect?"
   Never ask for a long commitment. Never say "hop on a call" — say "45 min" or "quick chat."

TONE RULES:
• Warm, direct, peer-to-peer — not a pitch, not a cold email blast
• Never say "love your content," "amazing work," "crushing it," or anything generic
• Never be condescending. No "you're leaving money on the table."
• If the channel is ig_personal, tone can be slightly more casual (drop the "partnerships team" framing, speak as yourself)
• Max ~250 characters total. Short paragraphs, each on its own line.

Return ONLY the final DM text. No labels, no quotes, no explanation.`;



const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

export async function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const leadId    = searchParams.get("lead_id");
  const channel   = searchParams.get("channel") || "ig_fanbasis";
  const name      = searchParams.get("name") || "";
  const bio       = searchParams.get("bio") || "";
  const followers = searchParams.get("followers") || "";
  const username  = searchParams.get("ig_username") || "";

  // If we have a lead_id, try to pull from research_cache first
  if (leadId) {
    try {
      const db = supabaseServer();
      const { data: lead } = await db
        .from("leads")
        .select("research_cache, name, bio, follower_count, ig_username")
        .eq("id", leadId)
        .maybeSingle();

      if (lead?.research_cache?.openers) {
        const cached = channel === "ig_personal"
          ? lead.research_cache.openers.personal || lead.research_cache.openers.ig
          : lead.research_cache.openers.ig;
        if (cached) {
          return NextResponse.json({ opener: cached, source: "cache" }, { headers: CORS });
        }
      }

      const userMsg = buildUserMsg(
        lead?.ig_username || username,
        lead?.name || name,
        lead?.bio || bio,
        lead?.follower_count?.toString() || followers,
        channel,
      );
      const opener = await ask(SYSTEM, userMsg, 500);
      return NextResponse.json({ opener: opener.trim(), source: "generated" }, { headers: CORS });
    } catch {
      // fall through to non-lead path
    }
  }

  if (!username && !name && !bio) {
    return NextResponse.json({ opener: null }, { status: 400, headers: CORS });
  }

  try {
    const userMsg = buildUserMsg(username, name, bio, followers, channel);
    const opener = await ask(SYSTEM, userMsg, 500);
    return NextResponse.json({ opener: opener.trim(), source: "generated" }, { headers: CORS });
  } catch (err) {
    console.error("[opener]", err);
    return NextResponse.json({ error: "Generation failed" }, { status: 500, headers: CORS });
  }
}

function buildUserMsg(
  username: string,
  name: string,
  bio: string,
  followers: string,
  channel: string,
) {
  const firstName = (name || "").split(/\s+/)[0] || username || "them";
  const bioLine = bio ? `Bio: "${bio}"` : "Bio: (none — infer from username and follower count)";
  return `Write a cold DM for this creator following the 3-part structure exactly.

Creator:
- First name: ${firstName}${name && name !== firstName ? ` (full: ${name})` : ""}
- IG: @${username || "unknown"}
- Followers: ${followers || "unknown"}
- ${bioLine}
- Channel: ${channel}

PART 1 must reference something SPECIFIC from their bio or niche — not generic. If the bio is empty, infer from their username or follower count (micro vs macro creator). Never write a generic hook.
PART 2 picks 2 of the 3 FanBasis props most relevant to their situation.
PART 3 ends with a single low-commitment ask using "45 min".

Return ONLY the DM text. No labels, no quotes.`;
}
