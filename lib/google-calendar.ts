// Server-side Google Calendar access for repToken-authenticated routes.
// Tokens live in user_integrations (integration_type "google", config jsonb
// holding refresh_token/access_token/expires_at/scopes), persisted at sign-in
// by lib/auth.ts and refreshed here independently of any NextAuth cookie.
import type { JWT } from "next-auth/jwt";
import { supabaseServer } from "@/lib/supabase";
import { refreshAccessToken } from "@/lib/auth";

export const DEFAULT_TIMEZONE = "America/New_York";
export const DEFAULT_SLOT_MINS = 30;

interface GoogleConfig {
  refresh_token?: string;
  access_token?: string;
  expires_at?: number; // unix seconds
  scopes?: string;
  timezone?: string;
  slot_mins?: number;
}

export type GoogleAccess =
  | { ok: true; accessToken: string; timezone: string; slotMins: number }
  | { ok: false; needsCalendar: true };

// True when the stored grant can touch Google Calendar (either calendar scope).
export function hasCalendarScope(scopes: string | undefined): boolean {
  return !!scopes?.includes("https://www.googleapis.com/auth/calendar");
}

export async function getGoogleIntegration(repId: string): Promise<GoogleConfig | null> {
  const db = supabaseServer();
  const { data } = await db
    .from("user_integrations")
    .select("id, config")
    .eq("user_id", repId)
    .eq("integration_type", "google")
    .maybeSingle();
  return (data?.config as GoogleConfig) ?? null;
}

// Loads the rep's Google grant and returns a live access token, refreshing
// (and persisting the refresh) if expired. Any state that a re-sign-in would
// fix — no grant, no calendar scope, revoked refresh token — comes back as
// { needsCalendar: true } so the extension can prompt one.
export async function getGoogleAccess(repId: string): Promise<GoogleAccess> {
  const db = supabaseServer();
  const { data: row } = await db
    .from("user_integrations")
    .select("id, config")
    .eq("user_id", repId)
    .eq("integration_type", "google")
    .maybeSingle();

  const config = (row?.config as GoogleConfig) ?? null;
  if (!row || !config?.refresh_token || !hasCalendarScope(config.scopes)) {
    return { ok: false, needsCalendar: true };
  }

  const timezone = config.timezone ?? DEFAULT_TIMEZONE;
  const slotMins = config.slot_mins ?? DEFAULT_SLOT_MINS;

  // Still valid (60s safety margin)?
  if (
    config.access_token &&
    config.expires_at &&
    Date.now() < (config.expires_at - 60) * 1000
  ) {
    return { ok: true, accessToken: config.access_token, timezone, slotMins };
  }

  const refreshed = await refreshAccessToken({
    refresh_token: config.refresh_token,
    access_token: config.access_token,
    expires_at: config.expires_at,
  } as JWT);
  if (refreshed.error || !refreshed.access_token) {
    // Refresh token revoked/expired — only a new consent fixes this.
    return { ok: false, needsCalendar: true };
  }

  await db
    .from("user_integrations")
    .update({
      config: {
        ...config,
        access_token: refreshed.access_token,
        expires_at: refreshed.expires_at,
        refresh_token: refreshed.refresh_token ?? config.refresh_token,
      },
    })
    .eq("id", row.id);

  return { ok: true, accessToken: refreshed.access_token, timezone, slotMins };
}

// ── Open-slot computation ────────────────────────────────────────────────────
// Port of calFindOpenSlots in chrome-extension/ig-lead-tracker/background.js:
// slots start ≥1h from now on 15-min marks, business hours 9:00–18:00, no
// weekends, skipping busy ranges. The extension used the rep machine's local
// clock; server-side we evaluate business hours in the rep's timezone.

interface BusyRange {
  start: number;
  end: number;
}

function tzClock(timeZone: string) {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "numeric",
    hour12: false,
  });
  return (ts: number) => {
    const parts = fmt.formatToParts(new Date(ts));
    const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
    return {
      weekend: get("weekday") === "Sat" || get("weekday") === "Sun",
      hour: Number(get("hour")) % 24, // hour12:false can yield "24" at midnight
      minute: Number(get("minute")),
    };
  };
}

export function findOpenSlots(opts: {
  busy: BusyRange[];
  timezone: string;
  slotMins?: number;
  days?: number;
  maxSlots?: number;
}): { start: string; end: string }[] {
  const slotMins = opts.slotMins || DEFAULT_SLOT_MINS;
  const days = opts.days || 7;
  // No cap by default — the old 5-slot cap made everything past day one look
  // booked solid in the dashboard month view.
  const maxSlots = opts.maxSlots || Infinity;
  const slotMs = slotMins * 60 * 1000;
  const stepMs = 15 * 60 * 1000;
  const now = Date.now();
  const clock = tzClock(opts.timezone);

  // Start at least 1 hour from now, rounded up to next 15-min mark
  let cursor = Math.ceil((now + 60 * 60 * 1000) / stepMs) * stepMs;
  const endTs = now + days * 24 * 60 * 60 * 1000;
  const slots: { start: string; end: string }[] = [];

  while (cursor < endTs && slots.length < maxSlots) {
    const at = clock(cursor);
    if (at.weekend || at.hour < 9) {
      cursor += stepMs;
      continue;
    }
    const slotEndTs = cursor + slotMs;
    const atEnd = clock(slotEndTs);
    if (atEnd.hour > 18 || (atEnd.hour === 18 && atEnd.minute > 0) || atEnd.hour < at.hour) {
      cursor += stepMs;
      continue;
    }

    const isBusy = opts.busy.some((b) => cursor < b.end && slotEndTs > b.start);
    if (!isBusy) {
      slots.push({
        start: new Date(cursor).toISOString(),
        end: new Date(slotEndTs).toISOString(),
      });
    }
    cursor += stepMs;
  }
  return slots;
}

// ── Google Calendar REST ─────────────────────────────────────────────────────

type FreeBusyResponse = {
  calendars?: Record<
    string,
    { busy?: { start: string; end: string }[]; errors?: { reason?: string }[] }
  >;
};

// Shared freeBusy call. `calendarId` is "primary" (the actor's own calendar)
// or an AE's email — readable across the Workspace domain via normal
// free/busy sharing. CRITICAL: Google reports a calendar it can't read as
// errors + empty busy, NOT as an HTTP failure — treating that as "fully
// free" would fabricate availability, so it throws instead.
async function freeBusyQuery(
  accessToken: string,
  timeMin: string,
  timeMax: string,
  calendarId: string
): Promise<BusyRange[]> {
  const resp = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
    method: "POST",
    headers: { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ timeMin, timeMax, items: [{ id: calendarId }] }),
  });
  if (!resp.ok) throw new Error(`freebusy_${resp.status}`);
  const data = (await resp.json()) as FreeBusyResponse;

  const busy: BusyRange[] = [];
  for (const cal of Object.values(data.calendars ?? {})) {
    if (cal.errors?.length) throw new Error("freebusy_unreadable");
    for (const b of cal.busy ?? []) {
      busy.push({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() });
    }
  }
  return busy;
}

export async function fetchBusyRanges(
  accessToken: string,
  days: number,
  calendarId = "primary"
): Promise<BusyRange[]> {
  const timeMin = new Date().toISOString();
  const timeMax = new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString();
  return freeBusyQuery(accessToken, timeMin, timeMax, calendarId);
}

// Book-time freshness check: is this exact window still free? Guards against
// a slot getting taken between the picker loading and the rep confirming.
export async function isSlotBusy(
  accessToken: string,
  slotStart: string,
  slotEnd: string,
  calendarId = "primary"
): Promise<boolean> {
  const busy = await freeBusyQuery(accessToken, slotStart, slotEnd, calendarId);
  return busy.length > 0;
}

// Mirrors CREATE_CALENDAR_EVENT in background.js (title format, tentative
// status, optional guest attendee).
export async function createCalendarEvent(opts: {
  accessToken: string;
  slotStart: string;
  slotEnd: string;
  leadName?: string;
  guestEmail?: string;
  repName?: string | null;
  aeName?: string | null;
  aeEmail?: string | null;
  timezone: string;
}): Promise<{ eventId: string; htmlLink: string }> {
  const displayLead = (opts.leadName || "Lead").split(" ").slice(0, 2).join(" ");
  // The call is with the AE when one is chosen; the rep only hosts the hold.
  const displayUser = (opts.aeName || opts.repName || "FanBasis").split(" ")[0];
  const attendees = [
    ...(opts.aeEmail ? [{ email: opts.aeEmail }] : []),
    ...(opts.guestEmail ? [{ email: opts.guestEmail }] : []),
  ];
  const body = {
    summary: `FanBasis Discovery: ${displayLead} X ${displayUser}`,
    start: { dateTime: opts.slotStart, timeZone: opts.timezone },
    end: { dateTime: opts.slotEnd, timeZone: opts.timezone },
    status: "tentative",
    description: opts.aeName
      ? `Discovery call with ${opts.aeName}${opts.repName ? ` — booked by ${opts.repName}` : ""} via FanBasis Sales Ops`
      : "Booking sent via FanBasis Sales Extension",
    ...(attendees.length ? { attendees } : {}),
  };
  const resp = await fetch(
    // Event lives on the rep's calendar; the AE + lead are attendees.
    // sendUpdates=all so both actually receive the invite email.
    "https://www.googleapis.com/calendar/v3/calendars/primary/events?sendUpdates=all",
    {
      method: "POST",
      headers: { Authorization: `Bearer ${opts.accessToken}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }
  );
  if (!resp.ok) throw new Error(`create_event_${resp.status}`);
  const event = (await resp.json()) as { id: string; htmlLink: string };
  return { eventId: event.id, htmlLink: event.htmlLink };
}
