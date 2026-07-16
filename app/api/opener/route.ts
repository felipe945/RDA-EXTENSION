import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { ask } from "@/lib/claude";
import { getActor } from "@/lib/scope";
import {
  OPENER_TEMPLATES,
  FOLLOWUP_TEMPLATES,
  TEMPLATE_RULES,
} from "@/lib/prompts/openerTemplates";

const SYSTEM = `You are writing outbound Instagram DMs for Commas (formerly FanBasis) — a payments platform for online business owners. The leads are creators and sellers currently running on Whop. You do NOT write freeform copy: pick the single best-fitting approved template below, personalize it, and return it.

=== APPROVED OPENER TEMPLATES ===
${OPENER_TEMPLATES}

=== APPROVED FOLLOW-UP TEMPLATES (use ONLY when the request asks for a follow-up) ===
${FOLLOWUP_TEMPLATES}

${TEMPLATE_RULES}

Return ONLY the final DM text. No template labels, no quotes, no explanation.`;



// C3: CORS is an allowlist, never `*`. The extension calls this from its
// background service worker (D1), so its origin is chrome-extension://<id> —
// set EXTENSION_ID in the env. Unknown origins get no ACAO header at all.
function corsHeaders(req: NextRequest): Record<string, string> {
  const allowed = new Set(
    [
      process.env.NEXT_PUBLIC_BASE_URL,
      "https://fanmas.vercel.app",
      process.env.EXTENSION_ID ? `chrome-extension://${process.env.EXTENSION_ID}` : undefined,
    ]
      .filter((o): o is string => !!o)
      .map((o) => o.replace(/\/+$/, ""))
  );
  const headers: Record<string, string> = {
    "Access-Control-Allow-Methods": "GET, OPTIONS",
    "Access-Control-Allow-Headers": "authorization, content-type",
    Vary: "Origin",
  };
  const origin = req.headers.get("origin");
  if (origin && allowed.has(origin)) headers["Access-Control-Allow-Origin"] = origin;
  return headers;
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { status: 204, headers: corsHeaders(req) });
}

export async function GET(req: NextRequest) {
  const cors = corsHeaders(req);

  // C3: session or Bearer repToken required — this route spends Claude money
  // and writes research_cache.
  const actor = await getActor(req);
  if (!actor) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: cors });
  }

  const { searchParams } = new URL(req.url);
  const leadId    = searchParams.get("lead_id");
  const channel   = searchParams.get("channel") || "ig_fanbasis";
  const name      = searchParams.get("name") || "";
  const bio       = searchParams.get("bio") || "";
  const followers = searchParams.get("followers") || "";
  const username  = searchParams.get("ig_username") || "";
  // ?fresh=1 (or ?regenerate=1) skips the cached opener and generates a new,
  // varied one — this is what makes "Regenerate" actually produce something new.
  const fresh     = searchParams.get("fresh") === "1" || searchParams.get("regenerate") === "1";
  // ?type=followup selects from the follow-up template bank instead of openers.
  // Follow-ups never read or write the opener cache — always generated fresh.
  const followup  = searchParams.get("type") === "followup";

  // If we have a lead_id, try to pull from research_cache first
  if (leadId) {
    try {
      const db = supabaseServer();
      // Org-scoped: a foreign-org (or nonexistent) lead_id reads as not-found —
      // don't fall through to the generic generator with attacker-fed params.
      const { data: lead } = await db
        .from("leads")
        .select("research_cache, name, bio, follower_count, ig_username")
        .eq("id", leadId)
        .eq("org_id", actor.orgId)
        .maybeSingle();

      if (!lead) {
        return NextResponse.json({ error: "lead not found" }, { status: 404, headers: cors });
      }

      if (!fresh && !followup && lead?.research_cache?.openers) {
        const cached = channel === "ig_personal"
          ? lead.research_cache.openers.personal || lead.research_cache.openers.ig
          : lead.research_cache.openers.ig;
        if (cached) {
          return NextResponse.json({ opener: cached, source: "cache" }, { headers: cors });
        }
      }

      const userMsg = buildUserMsg(
        lead?.ig_username || username,
        lead?.name || name,
        lead?.bio || bio,
        lead?.follower_count?.toString() || followers,
        channel,
        fresh,
        followup,
      );
      const opener = (await ask(SYSTEM, userMsg, 500, 0.9)).trim();

      // Persist so the generation isn't thrown away — merge-patch into
      // research_cache.openers.{ig|personal} + suggestedOpener without clobbering
      // the rest of the cache. This is what makes generated openers stick (and
      // what flips research_cache->suggestedOpener non-null so the drain skips
      // this lead going forward). Best-effort — never fail the response on it.
      // Follow-ups are one-off messages and are never cached.
      if (!followup) try {
        const cache = (lead?.research_cache ?? {}) as Record<string, unknown>;
        const openers = { ...((cache.openers as Record<string, unknown>) ?? {}) };
        if (channel === "ig_personal") openers.personal = opener;
        else openers.ig = opener;
        const nextCache = {
          ...cache,
          openers,
          suggestedOpener: (openers.ig as string) ?? (openers.personal as string) ?? opener,
        };
        await db
          .from("leads")
          .update({ research_cache: nextCache, updated_at: new Date().toISOString() })
          .eq("id", leadId)
          .eq("org_id", actor.orgId);
      } catch (e) {
        console.error("[opener] failed to persist generated opener", e);
      }

      return NextResponse.json({ opener, source: "generated" }, { headers: cors });
    } catch {
      // fall through to non-lead path
    }
  }

  if (!username && !name && !bio) {
    return NextResponse.json({ opener: null }, { status: 400, headers: cors });
  }

  try {
    const userMsg = buildUserMsg(username, name, bio, followers, channel, fresh, followup);
    const opener = await ask(SYSTEM, userMsg, 500, 0.9);
    return NextResponse.json({ opener: opener.trim(), source: "generated" }, { headers: cors });
  } catch (err) {
    console.error("[opener]", err);
    return NextResponse.json({ error: "Generation failed" }, { status: 500, headers: cors });
  }
}

function buildUserMsg(
  username: string,
  name: string,
  bio: string,
  followers: string,
  channel: string,
  fresh = false,
  followup = false,
) {
  const firstName = (name || "").split(/\s+/)[0] || username || "them";
  const bioLine = bio ? `Bio: "${bio}"` : "Bio: (none — pick a template by username and follower count)";
  return `Write a ${followup ? "FOLLOW-UP DM (they never replied to the opener — use a follow-up template)" : "cold opener DM"} for this creator using the approved templates.

Creator:
- First name: ${firstName}${name && name !== firstName ? ` (full: ${name})` : ""}
- IG: @${username || "unknown"}
- Followers: ${followers || "unknown"}
- ${bioLine}
- Channel: ${channel}

Pick the ONE template whose angle best fits this lead, swap in their first name, and personalize per the rules. No cross-channel touch has happened unless stated here, so drop any "sent you a message on LinkedIn/Instagram too" line and use a standard intro instead.
${fresh ? "\nREGENERATE: they asked for a different version — pick a DIFFERENT template angle than the most obvious first choice, still following all the rules.\n" : ""}
Return ONLY the DM text. No labels, no quotes.`;
}
