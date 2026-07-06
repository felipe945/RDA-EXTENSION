import { inngest } from "@/lib/inngest";
import { getBaseUrl } from "@/lib/base-url";

// Durable, retrying wrapper around the existing research route. The IG-events
// handler previously fire-and-forgot a fetch to /api/ai/research-lead, so any
// transient Anthropic error silently dropped that lead's research. Routing it
// through an Inngest event gives us automatic retries with backoff.
export const researchLead = inngest.createFunction(
  {
    id: "research-lead",
    retries: 3,
    triggers: [{ event: "lead/research.requested" }],
  },
  async ({ event, step }) => {
    const { leadId } = event.data as { leadId: string };

    const baseUrl = getBaseUrl();

    const result = await step.run("call-research-route", async () => {
      const res = await fetch(`${baseUrl}/api/ai/research-lead`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          // research-lead is gated (getActor OR CRON_SECRET); this is the
          // trusted internal path.
          Authorization: `Bearer ${process.env.CRON_SECRET ?? ""}`,
        },
        body: JSON.stringify({ leadId }),
      });
      if (!res.ok) throw new Error(`research-lead failed: ${res.status}`);
      return res.json();
    });

    return result;
  }
);
