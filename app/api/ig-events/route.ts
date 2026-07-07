import { type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { scoreLead } from "@/lib/scoring";
import { enqueueResearch } from "@/lib/research-trigger";
import { verifyRepToken } from "@/lib/extension-token";

const igEventSchema = z.object({
  type: z.string(),
  username: z.string(),
  userId: z.string().optional(),
  pageUrl: z.string().optional(),
  bio: z.string().optional(),
  followerCount: z.number().optional(),
  profileUrl: z.string().optional(),
  displayName: z.string().optional(),
  savedFromAccount: z.string().optional(),
});

export async function POST(req: NextRequest) {
  // C4 — preferred auth is the rep's Bearer repToken (stamps rep_id on every
  // write). x-ig-secret stays as a fallback (rep_id null) so pre-CONNECT
  // extensions keep working mid-rollout.
  const rep = await verifyRepToken(req.headers.get("authorization"));
  const repId = rep?.rep_id ?? null;
  if (!rep) {
    const secret = req.headers.get("x-ig-secret");
    if (secret !== process.env.IG_EVENTS_SECRET) {
      return Response.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const rawBody = await req.json();
  const parsed = igEventSchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const body = parsed.data;
  const { type, username, userId, pageUrl, bio, followerCount, profileUrl, displayName } = body;

  const db = supabaseServer();

  // Under C1 scoping a lead without org_id is invisible to everyone, so every
  // insert must carry one. repToken carries the rep's org; the legacy
  // x-ig-secret path has no identity, so fall back to the sole org
  // (single-tenant today — revisit if a second org ever exists).
  let orgId = rep?.team_id ?? null;
  if (!orgId) {
    const { data: org } = await db.from("orgs").select("id").limit(1).maybeSingle();
    orgId = (org?.id as string) ?? null;
  }

  if (type === "IG_PROFILE_SAVE") {
    const now = new Date().toISOString();
    const saveEvent = { type, postUrl: profileUrl ?? pageUrl ?? null, ts: now, rep_id: repId };

    // Canonical profile URL from the handle — never trust the client's page URL.
    // Falls back to the client value only for a (theoretical) username-less save.
    const canonicalIgUrl = username
      ? `https://www.instagram.com/${String(username).replace(/^@/, "")}/`
      : (profileUrl ?? null);

    // Find or create lead by IG username (fetch ig_events for append)
    const { data: existing } = await db
      .from("leads")
      .select("id, ig_events")
      .eq("ig_username", username)
      .maybeSingle();

    const score = scoreLead({
      bio: bio ?? undefined,
      followerCount: followerCount ?? undefined,
      externalUrl: undefined,
    });

    let leadId: string;

    if (existing) {
      leadId = existing.id as string;
      const igEvents = Array.isArray(existing.ig_events) ? existing.ig_events : [];
      await db
        .from("leads")
        .update({
          bio: bio ?? null,
          follower_count: followerCount ?? null,
          // undefined = leave the existing value alone rather than nulling it
          // (the extension's saveLead sends no profileUrl on re-saves).
          ig_profile_url: canonicalIgUrl ?? undefined,
          name: displayName ?? username,
          score,
          research_status: "pending",
          ig_events: [...igEvents, saveEvent],
          updated_at: now,
          ig_user_id: userId ?? undefined,
          source_account: (body.savedFromAccount as string | undefined) ?? undefined,
          rep_id: repId ?? undefined,
        })
        .eq("id", leadId);
    } else {
      const dueAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
      const { data: newLead, error: insertError } = await db
        .from("leads")
        .insert({
          ig_username: username,
          name: displayName ?? username,
          source: "IG",
          mode: "sales",
          stage: "New",
          bio: bio ?? null,
          follower_count: followerCount ?? null,
          ig_profile_url: canonicalIgUrl,
          ig_user_id: userId ?? null,
          source_account: (body.savedFromAccount as string | undefined) ?? null,
          score,
          research_status: "pending",
          ig_events: [saveEvent],
          due_at: dueAt,
          updated_at: now,
          org_id: orgId,
          // key omitted when unauthenticated-by-token so the legacy x-ig-secret
          // path keeps inserting during the deploy→migration-014 window
          ...(repId ? { rep_id: repId } : {}),
        })
        .select("id")
        .maybeSingle();

      if (insertError || !newLead) {
        return Response.json({ error: "Failed to create lead" }, { status: 500 });
      }

      leadId = newLead.id as string;
    }

    // Durable research trigger. Prefers Inngest (retries transient Anthropic
    // failures); falls back to a direct fetch when Inngest is unconfigured or
    // send() throws. Never throws into the save response — a saved-but-
    // unresearched lead is fine (drain retries), a failed save loses the lead.
    await enqueueResearch(leadId);

    return Response.json({ ok: true, leadId });
  }

  // --- Existing IG_FOLLOW / IG_LIKE handling ---

  // Find existing lead or create new one
  const { data: existing } = await db
    .from("leads")
    .select("id, ig_events, stage")
    .eq("ig_username", username)
    .maybeSingle();

  const event = { type, postUrl: pageUrl ?? null, ts: new Date().toISOString(), rep_id: repId };

  if (existing) {
    const igEvents = Array.isArray(existing.ig_events) ? existing.ig_events : [];
    await db
      .from("leads")
      .update({
        ig_events: [...igEvents, event],
        updated_at: new Date().toISOString(),
        rep_id: repId ?? undefined,
      })
      .eq("id", existing.id);
  } else {
    // New lead — auto-stage as Warming, due_at = 48h (opener window)
    const dueAt = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
    await db.from("leads").insert({
      ig_username: username,
      name: username,
      source: "IG",
      mode: "sales",
      stage: type === "follow" ? "Warming" : "New",
      ig_events: [event],
      due_at: dueAt,
      org_id: orgId,
      ...(repId ? { rep_id: repId } : {}),
    });
  }

  return Response.json({ ok: true });
}
