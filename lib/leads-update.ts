import { supabaseServer } from "@/lib/supabase";
import { scoreLead } from "@/lib/scoring";
import { canAccessLead, type Actor } from "@/lib/scope";
import { canSeeAllLeads } from "@/lib/permissions";

type DB = ReturnType<typeof supabaseServer>;

// Shared PATCH core used by both `/api/leads` (id in body) and `/api/leads/[id]`
// (id in path). Enforces actor scope, applies C2 ownership stamping, recomputes
// score when scoring-relevant fields change and merges outreach_channels
// server-side so concurrent channel writes don't clobber each other. Extracted
// so both entrypoints stay in lockstep — dashboard and extension writes get
// identical scoping/stamping.
//
// `status` accompanies `error` so routes can surface 403/404 instead of a
// blanket 500.
export async function applyLeadPatch(
  db: DB,
  id: string,
  fields: Record<string, unknown>,
  actor: Actor
) {
  // One SELECT serves scope enforcement, C2 stamping, score recompute, and the
  // outreach_channels merge.
  const { data: current, error: fetchError } = await db
    .from("leads")
    .select("org_id, owner_id, bio, follower_count, ig_profile_url, research_cache, outreach_channels")
    .eq("id", id)
    .maybeSingle();

  if (fetchError) return { data: null, error: fetchError, status: 500 };
  if (!current) return { data: null, error: { message: "lead not found" }, status: 404 };
  if (!canAccessLead(actor, current)) {
    return { data: null, error: { message: "forbidden" }, status: 403 };
  }

  // Reps never move ownership or org by hand — reassignment is the admin-only
  // assign route (C3).
  if (!canSeeAllLeads(actor.role)) {
    delete fields.owner_id;
    delete fields.org_id;
  }

  // C2 — sending the DM is the claim. First stage move to DM Sent/Replied on a
  // cold lead stamps the actor as owner; a non-null owner is never overwritten.
  if (
    (fields.stage === "DM Sent" || fields.stage === "Replied") &&
    current.owner_id == null &&
    fields.owner_id === undefined
  ) {
    fields = { ...fields, owner_id: actor.actorId };
  }

  const needsScoreRecompute = ["bio", "follower_count", "ig_profile_url", "research_cache"]
    .some((k) => k in fields);

  let score: number | undefined;
  if (needsScoreRecompute) {
    const merged = { ...current, ...fields };
    score = scoreLead({
      bio: merged.bio as string | undefined,
      followerCount: merged.follower_count as number | undefined,
      externalUrl: merged.ig_profile_url as string | undefined,
      researchCache: merged.research_cache as Record<string, unknown> | undefined,
    });
  }

  // Server-side merge for outreach_channels so concurrent channel writes don't clobber each other
  if ("outreach_channels" in fields && fields.outreach_channels && typeof fields.outreach_channels === "object") {
    fields.outreach_channels = {
      ...((current.outreach_channels as Record<string, unknown>) ?? {}),
      ...(fields.outreach_channels as Record<string, unknown>),
    };
  }

  const updatePayload: Record<string, unknown> = {
    ...fields,
    updated_at: new Date().toISOString(),
  };
  if (score !== undefined) updatePayload.score = score;

  const { data, error } = await db
    .from("leads")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .maybeSingle();
  return { data, error, status: error ? 500 : 200 };
}
