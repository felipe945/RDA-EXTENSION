// POST /api/leads/touch — Contract TOUCH (per-rep personal touches).
//
// The FanBasis touch stays team-shared (one entry, stamped with who sent it);
// personal-IG touches are per-rep (each rep gets their own entry under
// ig_personal_by, keyed by rep id, stamped server-side so clients can't
// clobber each other). The legacy `ig_personal` aggregate is DERIVED here on
// every personal write so extensions ≤2.12.0 still render something sane.
//
// This route NEVER writes stage — stage stays the send-flows' concern (only
// FanBasis sends set it). A personal DM never changes stage / never dequeues.
//
// Auth: /api/leads/* is an open prefix in proxy.ts, so this route
// self-authenticates via getActor() — NextAuth session (dashboard) OR Bearer
// repToken (extension) — exactly like /api/leads PATCH. Not in
// OPEN_API_PREFIXES by name; it inherits the prefix and must stay behind
// getActor.
import { type NextRequest } from "next/server";
import { z } from "zod";
import { supabaseServer } from "@/lib/supabase";
import { getActor, canAccessLead } from "@/lib/scope";
import { getSupabaseErrorMessage } from "@/lib/supabaseError";

const touchSchema = z.object({
  leadId: z.string().min(1),
  // linkedin is a shared channel like ig_fanbasis — the sidepanel's LinkedIn
  // marks route through here too so they can't clobber ig_personal_by.
  channel: z.enum(["ig_fanbasis", "ig_personal", "linkedin"]),
  sent: z.boolean().optional().default(true), // false un-marks
});

type PersonalEntry = {
  sent: boolean;
  sentAt: number;
  name: string | null;
  handle: string | null;
};

export async function POST(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) return Response.json({ error: "unauthorized" }, { status: 401 });

  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const parsed = touchSchema.safeParse(raw);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { leadId, channel, sent } = parsed.data;

  const db = supabaseServer();

  // Same users lookup bootstrap uses (name + personal_ig_username) — works for
  // both auth paths since actorId is the users.id.
  const { data: user } = await db
    .from("users")
    .select("*")
    .eq("id", actor.actorId)
    .maybeSingle();
  const repId = actor.actorId;
  const repName =
    (user?.name as string | null) ?? (user?.email as string | null) ?? null;
  const personalHandle = (user?.personal_ig_username as string | null) ?? null;

  // org/owner selected alongside outreach_channels for the same scope check
  // every other lead write does (applyLeadPatch / DELETE).
  const { data: lead } = await db
    .from("leads")
    .select("id, org_id, owner_id, outreach_channels")
    .eq("id", leadId)
    .maybeSingle();
  if (!lead) return Response.json({ error: "not_found" }, { status: 404 });
  if (!canAccessLead(actor, lead)) {
    return Response.json({ error: "forbidden" }, { status: 403 });
  }

  // Server-side deep merge — this route, not the client, owns the shape.
  const chs = (lead.outreach_channels ?? {}) as Record<string, unknown>;
  const now = Date.now();

  if (channel === "ig_fanbasis" || channel === "linkedin") {
    chs[channel] = sent
      ? { sent: true, sentAt: now, byId: repId, byName: repName }
      : { sent: false };
  } else {
    const by = {
      ...((chs.ig_personal_by as Record<string, PersonalEntry>) ?? {}),
    };
    by[repId] = sent
      ? { sent: true, sentAt: now, name: repName, handle: personalHandle }
      : { sent: false, sentAt: now, name: repName, handle: personalHandle };
    chs.ig_personal_by = by;
    // Legacy aggregate for ≤2.12.0 extensions: any rep's personal touch.
    const any = Object.values(by).find((e) => e?.sent);
    chs.ig_personal = any ? { sent: true, sentAt: any.sentAt } : { sent: false };
  }

  const { error } = await db
    .from("leads")
    .update({ outreach_channels: chs, updated_at: new Date().toISOString() })
    .eq("id", leadId);
  if (error) {
    return Response.json({ error: getSupabaseErrorMessage(error) }, { status: 500 });
  }

  return Response.json({ ok: true, outreach_channels: chs });
}
