// C3 — open booking slots on the rep's calendar, computed server-side from
// Google freeBusy using the same business-hours rules the extension used
// (9:00–18:00 rep-local, no weekends, 15-min marks, ≥1h out).
import { type NextRequest } from "next/server";
import { verifyRepToken } from "@/lib/extension-token";
import {
  getGoogleAccess,
  fetchBusyRanges,
  findOpenSlots,
} from "@/lib/google-calendar";

export async function GET(req: NextRequest) {
  const rep = await verifyRepToken(req.headers.get("authorization"));
  if (!rep) return Response.json({ ok: false }, { status: 401 });

  const params = req.nextUrl.searchParams;
  const days = Math.min(Math.max(Number(params.get("days")) || 7, 1), 14);
  const slotMins = Math.min(Math.max(Number(params.get("slotMins")) || 30, 15), 120);

  const access = await getGoogleAccess(rep.rep_id);
  if (!access.ok) return Response.json({ ok: false, needsCalendar: true });

  try {
    const busy = await fetchBusyRanges(access.accessToken, days);
    const slots = findOpenSlots({ busy, timezone: access.timezone, slotMins, days });
    return Response.json({ ok: true, slots });
  } catch (err) {
    // A 401 from Google here means the grant died between refresh and use —
    // same remediation as a missing scope: re-sign-in.
    if (err instanceof Error && err.message === "freebusy_401") {
      return Response.json({ ok: false, needsCalendar: true });
    }
    console.error("calendar slots failed", err);
    return Response.json({ ok: false, error: "calendar_unavailable" }, { status: 502 });
  }
}
