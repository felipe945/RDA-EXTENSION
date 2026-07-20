// POST /api/am/internal/classify — internal AI classification hop, fired
// (fire-and-forget) by lib/am/ingest.ts when a tracked conversation gets a new
// inbound. Open at the wall under /api/am/internal; gated by CRON_SECRET
// (hasInternalSecret, fail-closed). Skips when the newest message was already
// classified (ai_classified_msg_id cache) so re-deliveries don't re-bill.
import { type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { hasInternalSecret } from "@/lib/internal-auth";
import { askStructured } from "@/lib/claude";
import {
  PULSE_CLASSIFY_SYSTEM,
  PULSE_TOOL_SCHEMA,
  buildPulseClassifyPrompt,
  type PulseClassification,
} from "@/lib/prompts/pulse";

export const maxDuration = 60;

const bodySchema = z.object({ conversationId: z.string().uuid() });

export async function POST(req: NextRequest) {
  if (!hasInternalSecret(req)) {
    return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });
  }

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "conversationId required" }, { status: 400 });
  }

  const db = supabaseServer();
  const { data: convo } = await db
    .from("am_conversations")
    .select("id, channel, tracked, client_name, display_name, client_notes, ai_classified_msg_id")
    .eq("id", parsed.data.conversationId)
    .maybeSingle();
  if (!convo) return Response.json({ ok: false, error: "not found" }, { status: 404 });
  if (!convo.tracked) return Response.json({ ok: true, skipped: "untracked" });

  const { data: messages } = await db
    .from("am_messages")
    .select("external_id, direction, author, body, sent_at")
    .eq("conversation_id", convo.id)
    .order("sent_at", { ascending: false })
    .limit(25);
  if (!messages || messages.length === 0) {
    return Response.json({ ok: true, skipped: "no messages" });
  }

  const newest = messages[0];
  if (newest.external_id === convo.ai_classified_msg_id) {
    return Response.json({ ok: true, skipped: "already classified" });
  }

  const now = Date.now();
  const input = {
    clientName: (convo.client_name ?? convo.display_name) as string | null,
    clientNotes: convo.client_notes as string | null,
    channel: convo.channel as string,
    messages: [...messages].reverse().map((m) => ({
      author: m.author as string | null,
      direction: m.direction as "in" | "out",
      body: m.body as string | null,
      agoHours: (now - new Date(m.sent_at as string).getTime()) / 3_600_000,
    })),
  };

  let result: PulseClassification;
  try {
    result = await askStructured<PulseClassification>(
      PULSE_CLASSIFY_SYSTEM,
      buildPulseClassifyPrompt(input),
      "classify_conversation",
      PULSE_TOOL_SCHEMA,
      1024,
      0 // deterministic (D6b)
    );
  } catch (e) {
    // Leave ai_* untouched — the engine still fires on raw timestamps
    // (uncertain → flag), so a model outage can't silence a fire.
    console.error("[pulse-classify] model call failed", e);
    return Response.json({ ok: false, error: "classification failed" }, { status: 502 });
  }

  await db
    .from("am_conversations")
    .update({
      ai_needs_reply: result.needs_reply,
      ai_waiting_on: result.waiting_on,
      ai_open_commitment: result.open_commitment,
      ai_summary: result.summary,
      ai_suggested_reply: result.suggested_reply,
      ai_classified_msg_id: newest.external_id,
    })
    .eq("id", convo.id);

  return Response.json({ ok: true, classified: newest.external_id });
}
