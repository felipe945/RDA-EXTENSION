import { supabaseServer } from "@/lib/supabase";

// Terminal stages that don't count toward a rep's open workload. Mirrors the
// "archived" bucket in app/api/leads/route.ts (Closed | DQ | Churned).
const TERMINAL_STAGES = '("Closed","DQ","Churned")';

// Round-robin auto-balance: pick the rep with the fewest open leads who is still
// under capacity. No queue, no worker — one synchronous query pass.
export async function pickNextAssignee(orgId: string): Promise<string | null> {
  const db = supabaseServer();

  const { data: reps } = await db
    .from("memberships")
    .select("user_id, capacity")
    .eq("org_id", orgId)
    .eq("role", "rep");
  if (!reps || reps.length === 0) return null;

  const { data: openLeads } = await db
    .from("leads")
    .select("assigned_to")
    .eq("org_id", orgId)
    .not("stage", "in", TERMINAL_STAGES)
    .not("assigned_to", "is", null);

  const counts = new Map<string, number>();
  for (const lead of openLeads ?? []) {
    const id = lead.assigned_to as string;
    counts.set(id, (counts.get(id) ?? 0) + 1);
  }

  const eligible = reps
    .map((r) => ({ userId: r.user_id as string, capacity: r.capacity as number, open: counts.get(r.user_id as string) ?? 0 }))
    .filter((r) => r.open < r.capacity)
    .sort((a, b) => a.open - b.open);

  return eligible[0]?.userId ?? null;
}
