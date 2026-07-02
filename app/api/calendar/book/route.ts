// C3 — create the tentative discovery-call hold on the rep's personal
// calendar ("primary"; // TODO shared-cal), mirroring the event the extension
// used to create client-side.
// Auth via getActor (PARITY wave): dashboard session OR extension repToken.
// Optional `leadId` stages the lead to Booked through applyLeadPatch in the
// same call, so dashboard bookings get scope enforcement without a second
// round trip. The extension keeps its own follow-up PATCH (no leadId sent) —
// both paths converge on applyLeadPatch either way.
import { type NextRequest } from "next/server";
import { z } from "zod";
import { getActor } from "@/lib/scope";
import { supabaseServer } from "@/lib/supabase";
import { applyLeadPatch } from "@/lib/leads-update";
import { getSupabaseErrorMessage } from "@/lib/supabaseError";
import { getGoogleAccess, createCalendarEvent } from "@/lib/google-calendar";

const bookSchema = z.object({
  slotStart: z.string().min(1),
  slotEnd: z.string().min(1),
  leadName: z.string().optional(),
  guestEmail: z.string().email().optional(),
  leadId: z.string().uuid().optional(),
});

export async function POST(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) return Response.json({ ok: false }, { status: 401 });

  const parsed = bookSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const db = supabaseServer();

  // Check lead scope BEFORE creating the event — a 403 after the calendar
  // write would leave an orphaned hold on the rep's calendar.
  if (parsed.data.leadId) {
    const { data: lead } = await db
      .from("leads")
      .select("org_id, owner_id")
      .eq("id", parsed.data.leadId)
      .maybeSingle();
    if (!lead) return Response.json({ ok: false, error: "lead not found" }, { status: 404 });
    if (lead.org_id !== actor.orgId || (actor.role === "rep" && lead.owner_id != null && lead.owner_id !== actor.actorId)) {
      return Response.json({ ok: false, error: "forbidden" }, { status: 403 });
    }
  }

  const access = await getGoogleAccess(actor.actorId);
  if (!access.ok) return Response.json({ ok: false, needsCalendar: true });

  // repTokens carry a name; sessions don't — resolve it for the event title.
  const { data: user } = await db
    .from("users")
    .select("name")
    .eq("id", actor.actorId)
    .maybeSingle();

  try {
    const { eventId, htmlLink } = await createCalendarEvent({
      accessToken: access.accessToken,
      slotStart: parsed.data.slotStart,
      slotEnd: parsed.data.slotEnd,
      leadName: parsed.data.leadName,
      guestEmail: parsed.data.guestEmail,
      repName: (user?.name as string | null) ?? null,
      timezone: access.timezone,
    });

    // Stage the lead in the same call (dashboard path). Deliberately leaves
    // due_at alone — the old BookCallModal overwrote it with the call time,
    // which hijacked follow-up semantics.
    let lead = null;
    if (parsed.data.leadId) {
      const patched = await applyLeadPatch(db, parsed.data.leadId, { stage: "Booked" }, actor);
      if (patched.error) {
        // Event exists but the lead didn't move — surface it, don't pretend.
        return Response.json(
          { ok: true, eventId, htmlLink, leadError: getSupabaseErrorMessage(patched.error) },
          { status: 200 }
        );
      }
      lead = patched.data;
    }

    return Response.json({ ok: true, eventId, htmlLink, lead });
  } catch (err) {
    if (err instanceof Error && err.message === "create_event_401") {
      return Response.json({ ok: false, needsCalendar: true });
    }
    console.error("calendar book failed", err);
    return Response.json({ ok: false, error: "booking_failed" }, { status: 502 });
  }
}
