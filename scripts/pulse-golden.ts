// Golden accuracy set for the Pulse status engine (PULSE_BUILD.md §VERIFICATION 4).
// Pure — no DB, no network. Run: npx tsx scripts/pulse-golden.ts
import { computeStatus, type AmConversationRow } from "../lib/am/status";

// Fixed "now": 2026-07-20 17:00 UTC = 1pm ET (EDT) — outside quiet hours.
const NOW = new Date("2026-07-20T17:00:00Z");
// 06:00 UTC = 2am ET — inside quiet hours (red must clamp to amber).
const NIGHT = new Date("2026-07-20T06:00:00Z");

const hoursAgo = (h: number, from: Date = NOW) => new Date(from.getTime() - h * 3_600_000).toISOString();

const base: AmConversationRow = {
  tracked: true,
  muted: false,
  snoozed_until: null,
  checkin_days: 14,
  last_msg_at: null,
  last_direction: null,
  last_inbound_at: null,
  handled_at: null,
  ai_needs_reply: null,
  ai_waiting_on: null,
  ai_urgency: null,
  unanswered_count: 0,
  meta: {},
};

let failures = 0;
function expect(name: string, row: Partial<AmConversationRow>, want: { status: string; reason: string; seen?: boolean }, now: Date = NOW) {
  const got = computeStatus({ ...base, ...row }, now);
  const ok =
    got.status === want.status &&
    got.reason === want.reason &&
    (want.seen === undefined || got.seen === want.seen);
  if (!ok) {
    failures++;
    console.error(`✗ ${name}\n    want ${JSON.stringify(want)}\n    got  ${JSON.stringify(got)}`);
  } else {
    console.log(`✓ ${name}`);
  }
}

// 1. Client asked 5h ago, no reply → amber/owe_reply
expect("inbound 5h unanswered → amber", {
  last_direction: "in", last_msg_at: hoursAgo(5), last_inbound_at: hoursAgo(5),
}, { status: "amber", reason: "owe_reply" });

// 2a. 30h unanswered → red (midday)
expect("inbound 30h unanswered → red", {
  last_direction: "in", last_msg_at: hoursAgo(30), last_inbound_at: hoursAgo(30),
}, { status: "red", reason: "owe_reply" });

// 2b. Same at 2am ET → clamped to amber (fires at 7am)
expect("inbound 30h at 2am ET → amber (quiet clamp)", {
  last_direction: "in", last_msg_at: hoursAgo(30, NIGHT), last_inbound_at: hoursAgo(30, NIGHT),
}, { status: "amber", reason: "owe_reply" }, NIGHT);

// 3a. SEEN 14h ago-inbound → red at the 12h seen-threshold
expect("inbound 14h SEEN → red (12h escalation)", {
  last_direction: "in", last_msg_at: hoursAgo(14), last_inbound_at: hoursAgo(14),
  meta: { last_read_at: hoursAgo(13) },
}, { status: "red", reason: "owe_reply", seen: true });

// 3b. Same 14h but NOT seen → still amber (24h threshold)
expect("inbound 14h unseen → amber", {
  last_direction: "in", last_msg_at: hoursAgo(14), last_inbound_at: hoursAgo(14),
}, { status: "amber", reason: "owe_reply", seen: false });

// 4. Clear closer ("thanks!") — classifier stood it down → green/ok
expect("closer w/ ai_needs_reply=false → green", {
  last_direction: "in", last_msg_at: hoursAgo(30), last_inbound_at: hoursAgo(30),
  ai_needs_reply: false,
}, { status: "green", reason: "ok" });

// 5. The sneak case: Felipe replied "will do" 2d ago, ball still with him
expect("out + waiting_on you → amber/commitment", {
  last_direction: "out", last_msg_at: hoursAgo(48), last_outbound_at: hoursAgo(48),
  last_inbound_at: hoursAgo(50), ai_waiting_on: "you", ai_needs_reply: false,
}, { status: "amber", reason: "commitment" });

// 6. Felipe asked, client quiet 4 days → nudge
expect("out + 4d silence → amber/nudge", {
  last_direction: "out", last_msg_at: hoursAgo(96), last_outbound_at: hoursAgo(96),
  ai_waiting_on: "them",
}, { status: "amber", reason: "nudge" });

// 7. Quiet client at 15 days (checkin_days 14) → check-in
expect("15d no touch → amber/checkin", {
  last_direction: "in", last_msg_at: hoursAgo(15 * 24), last_inbound_at: hoursAgo(15 * 24),
  ai_needs_reply: false,
}, { status: "amber", reason: "checkin" });

// 8. Untracked never fires, no matter how bad it looks
expect("untracked 30h inbound → hidden", {
  tracked: false, last_direction: "in", last_msg_at: hoursAgo(30), last_inbound_at: hoursAgo(30),
}, { status: "hidden", reason: "untracked" });

// 9. Handled after the last inbound → suppressed until next message
expect("handled after inbound → green", {
  last_direction: "in", last_msg_at: hoursAgo(30), last_inbound_at: hoursAgo(30),
  handled_at: hoursAgo(1),
}, { status: "green", reason: "ok" });

// 9b. Handled BEFORE the latest inbound → still fires
expect("handled before newer inbound → red", {
  last_direction: "in", last_msg_at: hoursAgo(30), last_inbound_at: hoursAgo(30),
  handled_at: hoursAgo(40),
}, { status: "red", reason: "owe_reply" });

// 10. Snoozed → hidden until expiry
expect("snoozed → hidden", {
  last_direction: "in", last_msg_at: hoursAgo(30), last_inbound_at: hoursAgo(30),
  snoozed_until: new Date(NOW.getTime() + 24 * 3_600_000).toISOString(),
}, { status: "hidden", reason: "snoozed" });

// 11. Not-yet-classified inbound (ai_needs_reply null) still fires — uncertain → flag
expect("unclassified 30h inbound → red (uncertain flags)", {
  last_direction: "in", last_msg_at: hoursAgo(30), last_inbound_at: hoursAgo(30),
  ai_needs_reply: null,
}, { status: "red", reason: "owe_reply" });

// 12. Fresh inbound (1h) → green but visible as fresh
expect("inbound 1h → green/fresh_inbound", {
  last_direction: "in", last_msg_at: hoursAgo(1), last_inbound_at: hoursAgo(1),
}, { status: "green", reason: "fresh_inbound" });

// --- "Fires actually need to be fires" (2026-07-20) ---

// 13. Real problem (AI urgency=high), only 2h old → already RED
expect("urgent issue 2h → red (1h urgent threshold)", {
  last_direction: "in", last_msg_at: hoursAgo(2), last_inbound_at: hoursAgo(2),
  ai_urgency: "high", ai_needs_reply: true, unanswered_count: 1,
}, { status: "red", reason: "owe_reply" });

// 14. Low-stakes chatter, 30h old → CAPPED at amber, never a fire
expect("low urgency 30h → amber cap (chatter can't be a fire)", {
  last_direction: "in", last_msg_at: hoursAgo(30), last_inbound_at: hoursAgo(30),
  ai_urgency: "low", ai_needs_reply: true,
}, { status: "amber", reason: "owe_reply" });

// 15. Pile-on: 4 unanswered messages, only 2h old → RED even without AI
expect("4 msgs piled up 2h → red (pile-on)", {
  last_direction: "in", last_msg_at: hoursAgo(2), last_inbound_at: hoursAgo(2),
  unanswered_count: 4,
}, { status: "red", reason: "owe_reply" });

// 16. Pile-on OVERRIDES a low-urgency verdict (they kept pinging)
expect("low urgency but 5 msgs piled → red", {
  last_direction: "in", last_msg_at: hoursAgo(3), last_inbound_at: hoursAgo(3),
  ai_urgency: "low", unanswered_count: 5,
}, { status: "red", reason: "owe_reply" });

// 17. Urgent but brand-new (20 min) → amber immediately (surfaces fast, red at 1h)
expect("urgent 0.3h → amber (not yet red, but surfaced)", {
  last_direction: "in", last_msg_at: hoursAgo(0.3), last_inbound_at: hoursAgo(0.3),
  ai_urgency: "high", unanswered_count: 1,
}, { status: "amber", reason: "owe_reply" });

// 18. Medium urgency ordinary question keeps the normal 24h clock
expect("medium urgency 14h unseen → amber (normal clock)", {
  last_direction: "in", last_msg_at: hoursAgo(14), last_inbound_at: hoursAgo(14),
  ai_urgency: "medium", unanswered_count: 1,
}, { status: "amber", reason: "owe_reply" });

if (failures > 0) {
  console.error(`\n${failures} golden check(s) FAILED`);
  process.exit(1);
}
console.log("\nAll golden checks passed.");
