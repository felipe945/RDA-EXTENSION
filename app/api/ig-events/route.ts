import { type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { scoreLead } from "@/lib/scoring";

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-ig-secret");
  if (secret !== process.env.IG_EVENTS_SECRET) {
    return Response.json({ error: "Unauthorized" }, { status: 401 });
  }

  const body = await req.json() as Record<string, unknown>;
  const { type, username, userId, pageUrl, bio, followerCount, profileUrl, displayName } = body as {
    type?: string;
    username?: string;
    userId?: string;
    pageUrl?: string;
    bio?: string;
    followerCount?: number;
    profileUrl?: string;
    displayName?: string;
  };

  if (!type || !username) {
    return Response.json({ error: "Missing type or username" }, { status: 400 });
  }

  const db = supabaseServer();

  if (type === "IG_PROFILE_SAVE") {
    const now = new Date().toISOString();
    const saveEvent = { type, postUrl: profileUrl ?? pageUrl ?? null, ts: now };

    // Find or create lead by IG username (fetch ig_events for append)
    const { data: existing } = await db
      .from("leads")
      .select("id, ig_events")
      .eq("ig_username", username)
      .single();

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
          score,
          research_status: "pending",
          ig_events: [saveEvent],
          due_at: dueAt,
          updated_at: now,
        })
        .select("id")
        .single();

      if (insertError || !newLead) {
        return Response.json({ error: "Failed to create lead" }, { status: 500 });
      }

      leadId = newLead.id as string;
    }

    // Fire-and-forget research trigger — do NOT await
    const baseUrl = process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : (process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000");
    void fetch(`${baseUrl}/api/ai/research-lead`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId }),
    });

    return Response.json({ ok: true, leadId });
  }

  // --- Existing IG_FOLLOW / IG_LIKE handling ---

  // Find existing lead or create new one
  const { data: existing } = await db
    .from("leads")
    .select("id, ig_events, stage")
    .eq("ig_username", username)
    .single();

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
