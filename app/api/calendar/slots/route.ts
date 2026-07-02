// C3 — open booking slots, computed server-side from Google freeBusy using
// the same business-hours rules the extension used (9:00–18:00 rep-local,
// no weekends, 15-min marks, ≥1h out).
// Auth via getActor (PARITY wave): dashboard session OR extension repToken.
// AE mode: pass ?aeId=<uuid> to read availability off that AE's calendar
// (their email, via Workspace free/busy sharing) instead of the rep's own.
import { type NextRequest } from "next/server";
import { getActor } from "@/lib/scope";
import { supabaseServer } from "@/lib/supabase";
import {
  getGoogleAccess,
  fetchBusyRanges,
  findOpenSlots,
} from "@/lib/google-calendar";

export async function GET(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) return Response.json({ ok: false }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const days = Math.min(Math.max(Number(params.get("days")) || 7, 1), 14);
  const slotMins = Math.min(Math.max(Number(params.get("slotMins")) || 30, 15), 120);
  const aeId = params.get("aeId");
  // Late-times override: calls normally end by 6:15 PM; late=1 extends to 8 PM.
  const afterHours = params.get("late") === "1";

  // Availability source: the chosen AE's calendar, else the rep's own.
  let calendarId = "primary";
  let ae: { id: string; name: string; email: string } | null = null;
  if (aeId) {
    const { data } = await supabaseServer()
      .from("account_executives")
      .select("id, name, email")
      .eq("id", aeId)
      .eq("org_id", actor.orgId)
      .eq("active", true)
      .maybeSingle();
    if (!data) return Response.json({ ok: false, error: "unknown_ae" }, { status: 404 });
    ae = data;
    calendarId = data.email;
  }

  const access = await getGoogleAccess(actor.actorId);
  if (!access.ok) return Response.json({ ok: false, needsCalendar: true });

  try {
    const busy = await fetchBusyRanges(access.accessToken, days, calendarId);
    const slots = findOpenSlots({ busy, timezone: access.timezone, slotMins, days, afterHours });
    return Response.json({ ok: true, slots, ae });
  } catch (err) {
    // A 401 from Google here means the grant died between refresh and use —
    // same remediation as a missing scope: re-sign-in.
    if (err instanceof Error && err.message === "freebusy_401") {
      return Response.json({ ok: false, needsCalendar: true });
    }
    // The AE's calendar isn't visible to this rep's Google account — showing
    // an empty busy list as "all free" would be fake availability.
    if (err instanceof Error && err.message === "freebusy_unreadable") {
      return Response.json({ ok: false, error: "ae_calendar_unreadable", ae });
    }
    console.error("calendar slots failed", err);
    return Response.json({ ok: false, error: "calendar_unavailable" }, { status: 502 });
  }
}
