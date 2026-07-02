// Dashboard port of the extension's outreach-queue.js (FBQueue) — the single
// source of truth for queue filtering, sorting, and batch-progress math.
// Keep the stage lists and formulas in lockstep with
// chrome-extension/ig-lead-tracker/outreach-queue.js; if one changes, change both.
import type { LeadPlus } from "@/components/ig";
import { isSnoozed } from "@/components/ig";

export type QueueChannel = "ig" | "email" | "linkedin";

export const DONE_STAGES = ["DM Sent", "Replied", "Qualifying", "Call Offered", "Booked", "Closed", "DQ", "Active", "Churned", "Blocked"];

// "Reached out" line: leads at/after these stages have been contacted on this channel.
export const CONTACTED_STAGES = ["DM Sent", "Replied", "Qualifying", "Call Offered", "Booked", "Active"];

// Dead stages excluded from the addressable batch entirely.
export const DEAD_STAGES = ["DQ", "Closed", "Churned", "Blocked"];

// Sort/display parity: sort by the SAME number the card shows (fitScore),
// fall back to the heuristic score.
export function sortScore(lead: LeadPlus): number {
  const cache = (lead.research_cache ?? {}) as Record<string, unknown>;
  return typeof cache.fitScore === "number" ? cache.fitScore : (lead.score ?? 0);
}

export function hasChannel(lead: LeadPlus, channel: QueueChannel): boolean {
  if (channel === "ig") return !!(lead.ig_username || lead.ig_profile_url);
  if (channel === "email") return !!lead.email;
  if (channel === "linkedin") return !!lead.linkedin_url;
  return true;
}

// Canonical OPEN queue: not-done, not-snoozed (server snoozed_until, C4),
// has the channel, sorted by displayed score desc.
export function buildQueue(leads: LeadPlus[], channel: QueueChannel): LeadPlus[] {
  return (leads ?? [])
    .filter((l) => !DONE_STAGES.includes(l.stage))
    .filter((l) => !isSnoozed(l))
    .filter((l) => hasChannel(l, channel))
    .sort((a, b) => sortScore(b) - sortScore(a));
}

// Batch progress = reached-out share of the addressable batch (contacted +
// still-open), NOT cursor position or a session-local counter — so it
// survives reloads and reads the same for every rep.
export function computeBatchProgress(leads: LeadPlus[], channel: QueueChannel): { contacted: number; total: number; pct: number } {
  const addressable = (leads ?? []).filter((l) => hasChannel(l, channel) && !DEAD_STAGES.includes(l.stage));
  const total = addressable.length;
  const contacted = addressable.filter((l) => CONTACTED_STAGES.includes(l.stage)).length;
  const pct = total ? Math.round((contacted / total) * 100) : 0;
  return { contacted, total, pct };
}
