import { type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { scoreLead } from "@/lib/scoring";
import { inngest } from "@/lib/inngest";

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
  const secret = req.headers.get("x-ig-secret");
  if (secret !== process.env.IG_EVENTS_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
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

  if (type === "IG_PROFILE_SAVE") {
    const now = new Date().toISOString();
    const saveEvent = { type, postUrl: profileUrl ?? pageUrl ?? null, ts: now };

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
          ig_profile_url: profileUrl ?? null,
          name: displayName ?? username,
          score,
          research_status: "pending",
          ig_events: [...igEvents, saveEvent],
          updated_at: now,
          ig_user_id: userId ?? undefined,
          source_account: (body.savedFromAccount as string | undefined) ?? undefined,
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
          ig_profile_url: profileUrl ?? null,
          ig_user_id: userId ?? null,
          source_account: (body.savedFromAccount as string | undefined) ?? null,
          score,
          research_status: "pending",
          ig_events: [saveEvent],
          due_at: dueAt,
          updated_at: now,
        })
        .select("id")
        .maybeSingle();

      if (insertError || !newLead) {
        return Response.json({ error: "Failed to create lead" }, { status: 500 });
      }

      leadId = newLead.id as string;
    }

    // Durable research trigger. Inngest retries transient Anthropic failures with
    // backoff. But the save itself must NEVER fail because research couldn't be
    // enqueued — a saved-but-unresearched lead is fine (research_status stays
    // 'pending' and can be retried), a failed save loses the lead entirely.
    try {
      await inngest.send({ name: "lead/research.requested", data: { leadId } });
    } catch (err) {
      // Inngest unreachable (keys unset / dev server down). Fall back to the old
      // fire-and-forget direct call so research still runs pre-Inngest, and log
      // for Sentry instead of throwing into the save response.
      console.error("inngest.send failed, falling back to direct research fetch", err);
      const { getBaseUrl } = await import("@/lib/base-url");
      fetch(`${getBaseUrl()}/api/ai/research-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      }).catch((e) => console.error("fallback research fetch failed", e));
    }

    return Response.json({ ok: true, leadId });
  }

  // --- Existing IG_FOLLOW / IG_LIKE handling ---

  // Find existing lead or create new one
  const { data: existing } = await db
    .from("leads")
    .select("id, ig_events, stage")
    .eq("ig_username", username)
    .maybeSingle();

  const event = { type, postUrl: pageUrl ?? null, ts: new Date().toISOString() };

  if (existing) {
    const igEvents = Array.isArray(existing.ig_events) ? existing.ig_events : [];
    await db
      .from("leads")
      .update({
        ig_events: [...igEvents, event],
        updated_at: new Date().toISOString(),
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
    });
  }

  return Response.json({ ok: true });
}
