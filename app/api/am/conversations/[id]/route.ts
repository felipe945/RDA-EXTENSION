// /api/am/conversations/[id] — Felipe-only (owner/admin) single-conversation
// detail + controls. Same gating as the list route: wall enforces session,
// handler enforces admin, every query is org-scoped.
//   GET   → conversation + last 20 messages (detail drawer)
//   PATCH → { tracked?, muted?, client_name?, client_notes?, checkin_days?,
//             snooze_days?: 1|3|7|null, handled?: true }
import { type NextRequest } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { canViewPulse } from "@/lib/permissions";
import { fireClassify } from "@/lib/am/ingest";

type Ctx = { params: Promise<{ id: string }> };

import { z } from "zod";

const patchSchema = z.object({
  tracked: z.boolean().optional(),
  muted: z.boolean().optional(),
  client_name: z.string().trim().max(120).nullable().optional(),
  client_notes: z.string().max(4000).nullable().optional(),
  checkin_days: z.number().int().min(1).max(90).optional(),
  snooze_days: z.union([z.literal(1), z.literal(3), z.literal(7), z.null()]).optional(),
  handled: z.literal(true).optional(),
});

export async function GET(_req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.orgId || !canViewPulse(session.role)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const db = supabaseServer();
  const { data: conversation } = await db
    .from("am_conversations")
    .select("*")
    .eq("id", id)
    .eq("org_id", session.orgId)
    .maybeSingle();
  if (!conversation) return Response.json({ error: "not found" }, { status: 404 });

  const { data: messages } = await db
    .from("am_messages")
    .select("id, external_id, direction, author, body, sent_at")
    .eq("conversation_id", id)
    .order("sent_at", { ascending: false })
    .limit(20);

  return Response.json({ conversation, messages: (messages ?? []).reverse() });
}

export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params;
  const session = await getServerSession(authOptions);
  if (!session?.orgId || !canViewPulse(session.role)) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }

  const parsed = patchSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ error: "invalid payload" }, { status: 400 });
  }
  const p = parsed.data;

  const patch: Record<string, unknown> = {};
  if (p.tracked !== undefined) patch.tracked = p.tracked;
  if (p.muted !== undefined) patch.muted = p.muted;
  if (p.client_name !== undefined) patch.client_name = p.client_name || null;
  if (p.client_notes !== undefined) patch.client_notes = p.client_notes || null;
  if (p.checkin_days !== undefined) patch.checkin_days = p.checkin_days;
  if (p.snooze_days !== undefined) {
    patch.snoozed_until =
      p.snooze_days === null
        ? null
        : new Date(Date.now() + p.snooze_days * 24 * 3_600_000).toISOString();
  }
  if (p.handled) patch.handled_at = new Date().toISOString();
  if (Object.keys(patch).length === 0) {
    return Response.json({ error: "nothing to update" }, { status: 400 });
  }

  const db = supabaseServer();
  const { data, error } = await db
    .from("am_conversations")
    .update(patch)
    .eq("id", id)
    .eq("org_id", session.orgId)
    .select("id")
    .maybeSingle();
  if (error) return Response.json({ error: error.message }, { status: 500 });
  if (!data) return Response.json({ error: "not found" }, { status: 404 });

  // Newly tracked client → the AI reads the thread immediately (don't wait
  // for their next message to know where things stand).
  if (p.tracked === true) fireClassify(id);

  return Response.json({ ok: true });
}
