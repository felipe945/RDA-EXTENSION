import { inngest } from "@/lib/inngest";
import { supabaseServer } from "@/lib/supabase";

// Daily morning briefing: collects overdue follow-ups and pushes a summary to
// Slack via a plain Incoming Webhook (this runs server-side, outside any Claude
// Code session, so the Slack MCP is not available here).
export const dailyBriefing = inngest.createFunction(
  {
    id: "daily-briefing",
    retries: 2,
    triggers: [{ cron: "0 13 * * 1-5" }], // ~8am ET weekdays (13:00 UTC)
  },
  async ({ step }) => {
    const db = supabaseServer();

    const overdue = await step.run("fetch-overdue", async () => {
      const { data } = await db
        .from("leads")
        .select("id, name, ig_username, due_at, stage")
        .lt("due_at", new Date().toISOString())
        .not("stage", "in", "(Closed,DQ)")
        .order("due_at", { ascending: true });
      return data ?? [];
    });

    await step.run("send-slack", async () => {
      const webhook = process.env.SLACK_NOTIFICATIONS_WEBHOOK_URL;
      if (!webhook) return;

      const lines = overdue.map(
        (l) => `• ${l.name ?? l.ig_username} — ${l.stage}, due ${l.due_at}`
      );
      await fetch(webhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: overdue.length
            ? `*Morning briefing — ${overdue.length} overdue*\n${lines.join("\n")}`
            : "Morning briefing — nothing overdue today.",
        }),
      });
    });

    return { overdueCount: overdue.length };
  }
);
