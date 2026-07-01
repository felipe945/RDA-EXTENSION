import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { nightlyScoring } from "@/lib/inngest/functions/nightly-scoring";
import { dailyBriefing } from "@/lib/inngest/functions/daily-briefing";
import { researchLead } from "@/lib/inngest/functions/research-lead";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [nightlyScoring, dailyBriefing, researchLead],
});
