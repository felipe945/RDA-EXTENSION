import { inngest } from "@/lib/inngest";
import { supabaseServer } from "@/lib/supabase";
import { scoreLead } from "@/lib/scoring";

// Re-scores every active lead nightly so score drift (new heuristics, updated
// research cache) is reflected without waiting for the next IG event.
export const nightlyScoring = inngest.createFunction(
  {
    id: "nightly-lead-scoring",
    retries: 2,
    triggers: [{ cron: "0 6 * * *" }], // 6am UTC daily
  },
  async ({ step }) => {
    const db = supabaseServer();

    const leads = await step.run("fetch-active-leads", async () => {
      const { data } = await db
        .from("leads")
        .select("id, bio, follower_count, ig_profile_url")
        .not("stage", "in", "(Closed,DQ)");
      return data ?? [];
    });

    await step.run("rescore", async () => {
      for (const lead of leads) {
        const score = scoreLead({
          bio: lead.bio ?? undefined,
          followerCount: lead.follower_count ?? undefined,
          externalUrl: lead.ig_profile_url ?? undefined,
        });
        await db.from("leads").update({ score }).eq("id", lead.id);
      }
    });

    return { rescored: leads.length };
  }
);
