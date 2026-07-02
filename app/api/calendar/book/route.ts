// C3 — create the tentative discovery-call hold on the rep's personal
// calendar ("primary"; // TODO shared-cal), mirroring the event the extension
// used to create client-side.
import { type NextRequest } from "next/server";
import { z } from "zod";
import { verifyRepToken } from "@/lib/extension-token";
import { getGoogleAccess, createCalendarEvent } from "@/lib/google-calendar";

const bookSchema = z.object({
  slotStart: z.string().min(1),
  slotEnd: z.string().min(1),
  leadName: z.string().optional(),
  guestEmail: z.string().email().optional(),
});

export async function POST(req: NextRequest) {
  const rep = await verifyRepToken(req.headers.get("authorization"));
  if (!rep) return Response.json({ ok: false }, { status: 401 });

  const parsed = bookSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return Response.json(
      { ok: false, error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }

  const access = await getGoogleAccess(rep.rep_id);
  if (!access.ok) return Response.json({ ok: false, needsCalendar: true });

  try {
    const { eventId, htmlLink } = await createCalendarEvent({
      accessToken: access.accessToken,
      slotStart: parsed.data.slotStart,
      slotEnd: parsed.data.slotEnd,
      leadName: parsed.data.leadName,
      guestEmail: parsed.data.guestEmail,
      repName: rep.name,
      timezone: access.timezone,
    });
    return Response.json({ ok: true, eventId, htmlLink });
  } catch (err) {
    if (err instanceof Error && err.message === "create_event_401") {
      return Response.json({ ok: false, needsCalendar: true });
    }
    console.error("calendar book failed", err);
    return Response.json({ ok: false, error: "booking_failed" }, { status: 502 });
  }
}
