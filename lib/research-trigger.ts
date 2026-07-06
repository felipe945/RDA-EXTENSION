// Server-side helper for durably kicking off lead research. Prefers Inngest
// (which retries transient Anthropic failures with backoff); falls back to a
// fire-and-forget direct call to /api/ai/research-lead when Inngest isn't
// configured OR the send throws. The caller's own write must NEVER fail because
// research couldn't be enqueued — a saved-but-unresearched lead is fine
// (research_status stays "pending" and the drain/cron will retry); a failed
// save loses the lead entirely.
//
// The bug this exists to fix: with no Inngest keys, `inngest.send()` silently
// no-ops (it does NOT throw), so a try/catch around it never triggered the
// fallback and research simply never ran. We now branch on config explicitly.
import { inngest } from "@/lib/inngest";
import { getBaseUrl } from "@/lib/base-url";

// Inngest only actually delivers when an event key is configured. Absent that,
// send() is a no-op and we must fall back to a direct call.
export function inngestConfigured(): boolean {
  return !!process.env.INNGEST_EVENT_KEY;
}

// Fire-and-forget POST to the research route. Never awaited by callers and never
// throws into their path. research-lead is gated (getActor OR CRON_SECRET), so
// this internal hop authenticates with the cron secret — unset CRON_SECRET means
// the call 401s (fail-closed) and the drain picks the lead up once it's set.
export function fireDirectResearch(leadId: string): void {
  fetch(`${getBaseUrl()}/api/ai/research-lead`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}`,
    },
    body: JSON.stringify({ leadId }),
  }).catch((e) => console.error("[research-trigger] direct research fetch failed", e));
}

// Enqueue research for a single lead. Use for real-time, single-lead saves
// (e.g. ig-events). For high-volume paths (bulk import, scrape scripts) prefer
// leaving leads in a drain-eligible status and letting the throttled cron drain
// pick them up — don't fan out hundreds of direct fetches at the Anthropic API.
export async function enqueueResearch(leadId: string): Promise<void> {
  if (inngestConfigured()) {
    try {
      await inngest.send({ name: "lead/research.requested", data: { leadId } });
      return;
    } catch (err) {
      console.error("[research-trigger] inngest.send failed; falling back to direct fetch", err);
    }
  }
  fireDirectResearch(leadId);
}
