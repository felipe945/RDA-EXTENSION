// Pulse status engine — pure, no IO, deterministic (D6: the engine is the
// primary truth; AI only refines it via ai_needs_reply / ai_waiting_on).
// Status is DERIVED AT READ TIME from real message directions + timestamps —
// there is no sweep job to drift out of date.

export type PulseStatus = "red" | "amber" | "green" | "hidden";
export type PulseReason =
  | "owe_reply"      // client spoke last, Felipe hasn't answered
  | "commitment"     // Felipe spoke last but promised something undelivered ("will do!")
  | "nudge"          // Felipe spoke last, client silent too long
  | "checkin"        // no touch either direction in checkin_days
  | "fresh_inbound"  // client spoke last but it's recent — not a fire yet
  | "ok"
  | "snoozed"
  | "muted"
  | "untracked";

// Thresholds (D3) — tune here, nowhere else.
const OWE_AMBER_HOURS = 4;
const OWE_RED_HOURS = 24;
const OWE_RED_HOURS_SEEN = 12; // he already OPENED it — escalate faster
const NUDGE_DAYS = 3;
const QUIET_START_ET = 23; // red is clamped to amber 11pm–7am ET (fires at 7am)
const QUIET_END_ET = 7;

export interface AmConversationRow {
  tracked: boolean;
  muted: boolean;
  snoozed_until: string | null;
  checkin_days: number;
  last_msg_at: string | null;
  last_direction: "in" | "out" | null;
  last_inbound_at: string | null;
  last_outbound_at?: string | null;
  handled_at: string | null;
  ai_needs_reply: boolean | null;
  ai_waiting_on: "you" | "them" | "none" | null;
  meta: Record<string, unknown> | null;
}

export interface PulseComputed {
  status: PulseStatus;
  reason: PulseReason;
  hoursSinceInbound: number | null;
  seen: boolean; // Slack read cursor says Felipe opened the thread after the last inbound
}

const HOUR_MS = 3_600_000;

function hoursSince(iso: string, now: Date): number {
  return (now.getTime() - new Date(iso).getTime()) / HOUR_MS;
}

// hourCycle h23 → 0-23 (hour12:false alone can yield "24" at midnight).
function inQuietHoursET(now: Date): boolean {
  const hour = Number(
    new Intl.DateTimeFormat("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
      hourCycle: "h23",
    }).format(now)
  );
  return hour >= QUIET_START_ET || hour < QUIET_END_ET;
}

function after(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a) return false;
  if (!b) return true;
  return new Date(a).getTime() >= new Date(b).getTime();
}

export function computeStatus(c: AmConversationRow, now: Date = new Date()): PulseComputed {
  const hoursSinceInbound = c.last_inbound_at ? hoursSince(c.last_inbound_at, now) : null;
  const lastReadAt = typeof c.meta?.last_read_at === "string" ? c.meta.last_read_at : null;
  const seen = !!(lastReadAt && c.last_inbound_at && after(lastReadAt, c.last_inbound_at));

  if (c.muted) return { status: "hidden", reason: "muted", hoursSinceInbound, seen };
  if (c.snoozed_until && new Date(c.snoozed_until) > now) {
    return { status: "hidden", reason: "snoozed", hoursSinceInbound, seen };
  }
  if (!c.tracked) return { status: "hidden", reason: "untracked", hoursSinceInbound, seen };

  // "Handled" is a touch: it suppresses fires until the NEXT message arrives.
  const handledSinceLastMsg = after(c.handled_at, c.last_msg_at ?? undefined) && !!c.handled_at;

  // Owe path: client spoke last and (per the classifier) expects an answer.
  // ai_needs_reply === false is the ONLY thing that stands down a fire —
  // null/undefined (not yet classified) still fires (uncertain → flag, D6d).
  if (
    c.last_direction === "in" &&
    hoursSinceInbound !== null &&
    !handledSinceLastMsg &&
    c.ai_needs_reply !== false
  ) {
    const redAt = seen ? OWE_RED_HOURS_SEEN : OWE_RED_HOURS;
    if (hoursSinceInbound >= redAt) {
      return {
        status: inQuietHoursET(now) ? "amber" : "red",
        reason: "owe_reply",
        hoursSinceInbound,
        seen,
      };
    }
    if (hoursSinceInbound >= OWE_AMBER_HOURS) {
      return { status: "amber", reason: "owe_reply", hoursSinceInbound, seen };
    }
    return { status: "green", reason: "fresh_inbound", hoursSinceInbound, seen };
  }

  // The sneak case: Felipe replied last, but the classifier says the ball is
  // still with him ("will do!" → undelivered promise).
  if (c.last_direction === "out" && c.ai_waiting_on === "you" && !handledSinceLastMsg) {
    return { status: "amber", reason: "commitment", hoursSinceInbound, seen };
  }

  // Nudge: Felipe asked / spoke last and the client has gone quiet.
  if (
    c.last_direction === "out" &&
    c.last_msg_at &&
    !handledSinceLastMsg &&
    hoursSince(c.last_msg_at, now) >= NUDGE_DAYS * 24
  ) {
    return { status: "amber", reason: "nudge", hoursSinceInbound, seen };
  }

  // Check-in: nothing either direction in checkin_days. Marking handled counts
  // as a touch so the card re-fires checkin_days later, not instantly.
  const lastTouch =
    c.handled_at && after(c.handled_at, c.last_msg_at ?? undefined) ? c.handled_at : c.last_msg_at;
  if (lastTouch && hoursSince(lastTouch, now) >= c.checkin_days * 24) {
    return { status: "amber", reason: "checkin", hoursSinceInbound, seen };
  }

  return { status: "green", reason: "ok", hoursSinceInbound, seen };
}
