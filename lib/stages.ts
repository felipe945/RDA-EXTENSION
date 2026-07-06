// lib/stages.ts — SINGLE SOURCE OF TRUTH for sales stages: the ordered list,
// colors, buckets, and the queue/terminal sets. Every other file (lib/queue,
// lib/stage-colors, lib/assignment, lib/types, api routes, and — via T2 — the
// components) imports from here instead of hardcoding its own array.
//
// BROWSER-PURE: no `supabase`, no `next/server`, no Node-only imports. T3
// bundles this (through lib/queue.ts) into the Chrome extension with esbuild;
// a server-only import here breaks the extension silently.
//
// Legacy tolerance is the whole point of centralizing: unknown/legacy stage
// values — the retired "Blocked" (0 leads live) and the CSM stages
// ("Active"/"At Risk"/"Churned", retired by migration 019) — render GRAY and
// stay editable instead of being mis-detected. Nothing here throws on an
// unknown string.

// Ordered canonical SALES stages. No "Blocked", no CSM stages.
export const STAGES = [
  "New",
  "Warming",
  "DM Sent",
  "Replied",
  "Qualifying",
  "Call Offered",
  "Booked",
  "Closed",
  "DQ",
] as const;

export type Stage = (typeof STAGES)[number];

// Stages that remove a lead from the OPEN outreach queue (already contacted or
// terminal). Membership preserved exactly from the historical lists MINUS the
// retired "Blocked"; legacy CSM "Active"/"Churned" kept for tolerance (so any
// stray CSM-stage lead still behaves as before). Typed `readonly string[]`
// rather than `Stage[]` precisely because it carries those legacy values.
export const DONE_STAGES: readonly string[] = [
  "DM Sent",
  "Replied",
  "Qualifying",
  "Call Offered",
  "Booked",
  "Closed",
  "DQ",
  "Active",
  "Churned",
];

// "Reached out" — the progress numerator (leads contacted on this channel).
export const CONTACTED_STAGES: readonly string[] = [
  "DM Sent",
  "Replied",
  "Qualifying",
  "Call Offered",
  "Booked",
  "Active",
];

// Dead — excluded from the addressable batch (progress denominator) entirely.
export const DEAD_STAGES: readonly string[] = ["DQ", "Closed", "Churned"];

// Terminal — don't count toward a rep's open workload (lib/assignment
// round-robin). Same membership as DEAD; named separately per its call site.
export const TERMINAL_STAGES: readonly string[] = ["Closed", "DQ", "Churned"];

const STAGE_COLORS: Record<string, string> = {
  New: "#64748b",
  Warming: "#f59e0b",
  "DM Sent": "#3b82f6",
  Replied: "#8b5cf6",
  Qualifying: "#06b6d4",
  "Call Offered": "#10b981",
  Booked: "#22c55e",
  Closed: "#475569",
  DQ: "#ef4444",
  // Legacy CSM — colored so historical rows read sensibly; NOT offered as choices.
  Active: "#22c55e",
  "At Risk": "#f59e0b",
  Churned: "#6b7280",
};

const GRAY = "#64748b";

// Known stage → its color; unknown/legacy (e.g. retired "Blocked") → gray.
// Never throws.
export function stageColor(stage: string): string {
  return STAGE_COLORS[stage] ?? GRAY;
}

export function isKnownStage(s: string): s is Stage {
  return (STAGES as readonly string[]).includes(s);
}

// Coarse bucket for grouping/labels. Mirrors the stage-level intent of
// components/Dashboard's urgency buckets (Active buckets as "booked").
// Unknown/legacy values → "unknown" (caller renders gray, keeps editable).
export function stageBucket(
  stage: string
): "new" | "active" | "booked" | "done" | "unknown" {
  switch (stage) {
    case "New":
    case "Warming":
      return "new";
    case "DM Sent":
    case "Replied":
    case "Qualifying":
    case "Call Offered":
      return "active";
    case "Booked":
    case "Active":
      return "booked";
    case "Closed":
    case "DQ":
    case "Churned":
      return "done";
    default:
      return "unknown";
  }
}

// Build a Postgres `col IN (...)` value list from stage names (properly quoted).
// Lets API routes reference stage sets without hand-quoting SQL fragments.
export function stageSqlList(stages: readonly string[]): string {
  return `(${stages.map((s) => `"${s}"`).join(",")})`;
}
