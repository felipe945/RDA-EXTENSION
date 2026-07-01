export const STAGE_COLORS: Record<string, string> = {
  New: "#64748b",
  Warming: "#f59e0b",
  "DM Sent": "#3b82f6",
  Replied: "#8b5cf6",
  Qualifying: "#06b6d4",
  "Call Offered": "#10b981",
  Booked: "#22c55e",
  Closed: "#475569",
  DQ: "#ef4444",
  // CSM
  Active: "#22c55e",
  "At Risk": "#f59e0b",
  Churned: "#6b7280",
};

export function stageColor(stage: string): string {
  return STAGE_COLORS[stage] ?? "#64748b";
}
