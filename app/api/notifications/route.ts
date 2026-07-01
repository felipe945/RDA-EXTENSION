import { type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";

export async function GET(request: NextRequest) {
  const db = supabaseServer();
  const mode = request.nextUrl.searchParams.get("mode") ?? "sales";
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 3600 * 1000).toISOString();

  // Inbound messages from any channel
  const { data: messages } = await db
    .from("messages")
    .select("id, channel, body, created_at, lead_id, leads!inner(id, name, ig_username, stage, mode)")
    .eq("direction", "inbound")
    .eq("leads.mode", mode)
    .gte("created_at", sevenDaysAgo)
    .order("created_at", { ascending: false })
    .limit(50);

  // Leads in "Replied" stage updated recently
  const { data: replied } = await db
    .from("leads")
    .select("id, name, ig_username, stage, updated_at")
    .eq("mode", mode)
    .eq("stage", "Replied")
    .gte("updated_at", sevenDaysAgo)
    .order("updated_at", { ascending: false })
    .limit(20);

  // Overdue leads (FU needed)
  const { data: overdue } = await db
    .from("leads")
    .select("id, name, ig_username, ig_profile_url, stage, due_at, score, research_cache")
    .eq("mode", mode)
    .lt("due_at", new Date().toISOString())
    .not("stage", "in", '("Booked","Closed","DQ","Churned","Replied","Qualifying","Call Offered")')
    .order("due_at", { ascending: true })
    .limit(20);

  // Build notification list — inbound messages first, then replied leads (deduplicated)
  const seenLeadIds = new Set<string>();
  const notifications: Array<{
    id: string;
    type: string;
    leadId: string;
    leadName: string;
    leadHandle: string | null;
    channel: string;
    summary: string;
    ts: string;
  }> = [];

  for (const m of messages ?? []) {
    const lead = (m.leads as unknown) as { id: string; name: string | null; ig_username: string | null; mode: string } | null;
    if (!lead || lead.mode !== mode) continue;
    seenLeadIds.add(lead.id);
    notifications.push({
      id: `msg_${m.id}`,
      type: `${m.channel}_reply`,
      leadId: lead.id,
      leadName: lead.name ?? lead.ig_username ?? "Unknown",
      leadHandle: lead.ig_username ?? null,
      channel: m.channel ?? "unknown",
      summary: (m.body as string | null)?.slice(0, 120) ?? "",
      ts: m.created_at as string,
    });
  }

  for (const l of replied ?? []) {
    if (seenLeadIds.has(l.id as string)) continue;
    notifications.push({
      id: `replied_${l.id}`,
      type: "replied",
      leadId: l.id as string,
      leadName: (l.name ?? l.ig_username ?? "Unknown") as string,
      leadHandle: (l.ig_username ?? null) as string | null,
      channel: "ig",
      summary: "Replied to your DM",
      ts: l.updated_at as string,
    });
  }

  notifications.sort((a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime());

  return Response.json({ notifications, overdue: overdue ?? [] });
}
