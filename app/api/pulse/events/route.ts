// POST /api/pulse/events — the ONLY write path for Pulse. Called exclusively
// by workers/pulse-bridge (Felipe's Mac: Slack poller + WhatsApp listener).
// Open at the wall (proxy.ts) because the bridge has no NextAuth session;
// authenticates via `Authorization: Bearer $PULSE_BRIDGE_SECRET` (timing-safe,
// fail-closed: unset secret → 503, nobody passes).
import { timingSafeEqual } from "node:crypto";
import { type NextRequest } from "next/server";
import { z } from "zod";
import { ingestMessages, applyConvoUpdates, recordHeartbeats } from "@/lib/am/ingest";

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), "invalid ISO date");

const msgSchema = z.object({
  channel: z.enum(["slack", "whatsapp"]),
  externalConvoId: z.string().min(1),
  externalMsgId: z.string().min(1),
  direction: z.enum(["in", "out"]),
  author: z.string().optional(),
  body: z.string(),
  sentAt: isoDate,
  displayName: z.string().optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
  raw: z.unknown().optional(),
});

const bodySchema = z.object({
  messages: z.array(msgSchema).max(200).optional(),
  heartbeats: z
    .array(
      z.object({
        channel: z.enum(["slack", "whatsapp"]),
        detail: z.record(z.string(), z.unknown()).optional(),
      })
    )
    .max(10)
    .optional(),
  convoUpdates: z
    .array(
      z.object({
        channel: z.enum(["slack", "whatsapp"]),
        externalConvoId: z.string().min(1),
        lastReadAt: isoDate,
      })
    )
    .max(500)
    .optional(),
});

function bridgeAuthed(req: NextRequest): boolean | "unconfigured" {
  const secret = process.env.PULSE_BRIDGE_SECRET;
  if (!secret) return "unconfigured";
  const auth = req.headers.get("authorization") ?? "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : "";
  if (token.length !== secret.length) return false;
  return timingSafeEqual(Buffer.from(token), Buffer.from(secret));
}

export async function POST(req: NextRequest) {
  const authed = bridgeAuthed(req);
  if (authed === "unconfigured") {
    return Response.json(
      { ok: false, error: "PULSE_BRIDGE_SECRET is not set on the server" },
      { status: 503 }
    );
  }
  if (!authed) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const parsed = bodySchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json({ ok: false, error: "invalid payload" }, { status: 400 });
  }

  const { messages = [], heartbeats = [], convoUpdates = [] } = parsed.data;
  const counts = await ingestMessages(messages);
  await applyConvoUpdates(convoUpdates);
  await recordHeartbeats(heartbeats);

  return Response.json({ ok: true, ...counts, convoUpdates: convoUpdates.length });
}
