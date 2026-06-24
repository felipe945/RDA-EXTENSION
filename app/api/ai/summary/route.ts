import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { ask } from "@/lib/claude";

export async function GET(req: NextRequest) {
  const mode = req.nextUrl.searchParams.get("mode") ?? "sales";
  const db = supabaseServer();
  const now = new Date();

  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const todayEnd   = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();
  const weekEnd    = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 7, 23, 59, 59).toISOString();

  const { data: leads } = await db
    .from("leads")
    .select("id, name, ig_username, stage, due_at, last_contact_at, phone, email, notes, score")
    .eq("mode", mode)
    .not("stage", "in", '("Closed","DQ","Churned")')
    .order("due_at", { ascending: true, nullsFirst: false })
    .limit(50);

  if (!leads || leads.length === 0) {
    return NextResponse.json({
      content: "No active leads to brief on today.",
      generatedAt: now.toISOString(),
    });
  }

  type LeadRow = typeof leads[0];

  const overdue  = leads.filter((l: LeadRow) => l.due_at && l.due_at < todayStart);
  const dueToday = leads.filter((l: LeadRow) => l.due_at && l.due_at >= todayStart && l.due_at <= todayEnd);
  const upcoming = leads.filter((l: LeadRow) => l.due_at && l.due_at > todayEnd && l.due_at <= weekEnd);
  const noDate   = leads.filter((l: LeadRow) => !l.due_at).slice(0, 5);

  function leadLine(l: LeadRow): string {
    const name = l.ig_username ? `@${l.ig_username}` : (l.name ?? "Unknown");
    const score = l.score ? ` [fit:${l.score}]` : "";
    const lastContact = l.last_contact_at
      ? ` (last contact: ${new Date(l.last_contact_at).toLocaleDateString()})`
      : " (never contacted)";
    const note = l.notes ? ` — "${String(l.notes).slice(0, 80)}"` : "";
    return `  - ${name} | ${l.stage}${score}${lastContact}${note}`;
  }

  const today = now.toLocaleDateString("en-US", {
    weekday: "long", month: "long", day: "numeric",
  });

  const system = `You are a sharp sales operations assistant for FanBasis, a platform at $1B+/year GMV across 20,000+ creators selling courses, coaching, and digital products.
Write punchy, actionable morning briefings for the rep. No fluff. No greeting. No sign-off. Use plain text with line breaks.`;

  const user = `Today is ${today}. Mode: ${mode.toUpperCase()}.

OVERDUE (${overdue.length}):
${overdue.length > 0 ? overdue.map(leadLine).join("\n") : "  None"}

DUE TODAY (${dueToday.length}):
${dueToday.length > 0 ? dueToday.map(leadLine).join("\n") : "  None"}

UPCOMING THIS WEEK (${upcoming.length}):
${upcoming.length > 0 ? upcoming.slice(0, 8).map(leadLine).join("\n") : "  None"}

NO DATE SET (${noDate.length} of ${leads.filter((l: LeadRow) => !l.due_at).length}):
${noDate.length > 0 ? noDate.map(leadLine).join("\n") : "  None"}

Write a crisp morning briefing (under 300 words) with:
1. One-sentence headline on today's single most important priority
2. Overdue section — who needs action NOW and what to say
3. Today's hits — a tactical note on each person due today
4. One power move to maximize conversions today based on this data`;

  try {
    const content = await ask(system, user, 600);
    return NextResponse.json({ content, generatedAt: now.toISOString() });
  } catch (err) {
    console.error("[summary] Gemini error:", err);
    return NextResponse.json({ error: "AI generation failed" }, { status: 500 });
  }
}
