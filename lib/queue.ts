// lib/queue.ts — the single source of truth for outreach-queue filtering,
// sorting, and batch-progress math, shared by the dashboard AND (bundled by T3
// via esbuild) the Chrome extension. Keep in lockstep with
// chrome-extension/ig-lead-tracker/outreach-queue.js until T3 collapses that
// copy onto this module.
//
// BROWSER-PURE + self-contained: no `@/components/*`, no `supabase`, no
// `next/server`, no Node-only imports. Stage sets come from lib/stages.ts
// (also browser-pure). A minimal structural `QueueLead` type stands in for the
// full Lead so nothing here depends on the component layer.
import { DONE_STAGES, CONTACTED_STAGES, DEAD_STAGES } from "@/lib/stages";

// Re-export the stage sets so existing `@/lib/queue` importers keep working.
export { DONE_STAGES, CONTACTED_STAGES, DEAD_STAGES };

export type QueueChannel = "ig" | "email" | "linkedin";

// Structural subset of Lead this module actually reads. Anything Lead-shaped
// (LeadPlus in the dashboard, the extension's plain lead objects) satisfies it.
export type QueueLead = {
  id: string;
  stage: string;
  score?: number | null;
  research_cache?: Record<string, unknown> | null;
  ig_username?: string | null;
  ig_profile_url?: string | null;
  email?: string | null;
  linkedin_url?: string | null;
  snoozed_until?: string | null;
};

// Callers pass EITHER a bare channel (dashboard: `buildQueue(leads, "ig")`) or
// an options object (extension: `buildQueue(leads, { channel, snoozed, now })`).
export type QueueOpts = {
  channel?: QueueChannel;
  snoozed?: Record<string, number>;
  now?: number;
};

function resolveOpts(
  arg?: QueueChannel | QueueOpts
): { channel: QueueChannel; snoozed: Record<string, number>; now: number } {
  if (typeof arg === "string") return { channel: arg, snoozed: {}, now: Date.now() };
  return {
    channel: arg?.channel ?? "ig",
    snoozed: arg?.snoozed ?? {},
    now: arg?.now ?? Date.now(),
  };
}

// Snooze check — superset of both prior implementations: server-side
// `snoozed_until` (the source of truth) OR a legacy local snooze map
// (pre-2.3.0 extension clients still pass one).
export function isSnoozed(
  lead: QueueLead,
  snoozed?: Record<string, number>,
  now?: number
): boolean {
  const t = now == null ? Date.now() : now;
  if (lead.snoozed_until && new Date(lead.snoozed_until).getTime() > t) return true;
  const until = snoozed && snoozed[lead.id];
  return !!until && until > t;
}

// Sort/display parity: sort by the SAME number the card shows (fitScore), fall
// back to the heuristic score.
export function sortScore(lead: QueueLead): number {
  const cache = (lead.research_cache ?? {}) as Record<string, unknown>;
  return typeof cache.fitScore === "number" ? cache.fitScore : (lead.score ?? 0);
}

export function hasChannel(lead: QueueLead, channel: QueueChannel): boolean {
  if (channel === "ig") return !!(lead.ig_username || lead.ig_profile_url);
  if (channel === "email") return !!lead.email;
  if (channel === "linkedin") return !!lead.linkedin_url;
  return true;
}

// Canonical OPEN queue: not-done, not-snoozed, has the channel, sorted by
// displayed score desc. Generic so callers get their concrete lead type back.
export function buildQueue<T extends QueueLead>(
  leads: T[],
  arg?: QueueChannel | QueueOpts
): T[] {
  const { channel, snoozed, now } = resolveOpts(arg);
  return (leads ?? [])
    .filter((l) => !DONE_STAGES.includes(l.stage))
    .filter((l) => !isSnoozed(l, snoozed, now))
    .filter((l) => hasChannel(l, channel))
    .sort((a, b) => sortScore(b) - sortScore(a));
}

// Batch progress = reached-out share of the addressable batch (contacted +
// still-open), NOT cursor position or a session-local counter — so it survives
// reloads and reads the same for every rep.
export function computeBatchProgress(
  leads: QueueLead[],
  arg?: QueueChannel | QueueOpts
): { contacted: number; total: number; pct: number } {
  const { channel } = resolveOpts(arg);
  const addressable = (leads ?? []).filter(
    (l) => hasChannel(l, channel) && !DEAD_STAGES.includes(l.stage)
  );
  const total = addressable.length;
  const contacted = addressable.filter((l) => CONTACTED_STAGES.includes(l.stage)).length;
  const pct = total ? Math.round((contacted / total) * 100) : 0;
  return { contacted, total, pct };
}
