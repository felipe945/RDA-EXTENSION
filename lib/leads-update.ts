import { supabaseServer } from "@/lib/supabase";
import { scoreLead } from "@/lib/scoring";

type DB = ReturnType<typeof supabaseServer>;

// Shared PATCH core used by both `/api/leads` (id in body) and `/api/leads/[id]`
// (id in path). Recomputes score when scoring-relevant fields change and merges
// outreach_channels server-side so concurrent channel writes don't clobber each
// other. Extracted so both entrypoints stay in lockstep.
export async function applyLeadPatch(db: DB, id: string, fields: Record<string, unknown>) {
  // Only SELECT when scoring-relevant fields are being changed — pure stage/note/
  // assignment patches skip the round trip.
  const needsScoreRecompute = ["bio", "follower_count", "ig_profile_url", "research_cache"]
    .some((k) => k in fields);

  let score: number | undefined;
  if (needsScoreRecompute) {
    const { data: current } = await db
      .from("leads")
      .select("bio, follower_count, ig_profile_url, research_cache")
      .eq("id", id)
      .maybeSingle();
    const merged = { ...(current ?? {}), ...fields };
    score = scoreLead({
      bio: merged.bio as string | undefined,
      followerCount: merged.follower_count as number | undefined,
      externalUrl: merged.ig_profile_url as string | undefined,
      researchCache: merged.research_cache as Record<string, unknown> | undefined,
    });
  }

  // Server-side merge for outreach_channels so concurrent channel writes don't clobber each other
  if ("outreach_channels" in fields && fields.outreach_channels && typeof fields.outreach_channels === "object") {
    const { data: currentLead } = await db
      .from("leads")
      .select("outreach_channels")
      .eq("id", id)
      .maybeSingle();
    fields.outreach_channels = {
      ...((currentLead?.outreach_channels as Record<string, unknown>) ?? {}),
      ...(fields.outreach_channels as Record<string, unknown>),
    };
  }

  const updatePayload: Record<string, unknown> = {
    ...fields,
    updated_at: new Date().toISOString(),
  };
  if (score !== undefined) updatePayload.score = score;

  return db.from("leads").update(updatePayload).eq("id", id).select().maybeSingle();
}
