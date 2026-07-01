/**
 * Runs every lead through Salesforce fuzzy matching and updates sf_status,
 * sf_confidence_score, sf_account_name, sf_match_reasons, sf_last_checked.
 *
 * Run: npx tsx --env-file=.env.local scripts/sf-lookup-all.ts
 */
import { createClient } from "@supabase/supabase-js";
import { lookupLeadInSalesforce } from "../lib/salesforce";

const CONCURRENCY = 5; // SF allows ~10 req/s; 5 is safe

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, name, ig_username, bio, sf_last_checked")
    .neq("stage", "DQ")
    .order("created_at", { ascending: true });

  if (error) { console.error("Supabase error:", error.message); process.exit(1); }
  if (!leads?.length) { console.log("No leads found."); return; }

  console.log(`\nRunning SF lookup on ${leads.length} leads (${CONCURRENCY} at a time)...\n`);

  let customers = 0, inactive = 0, prospects = 0, none = 0, errors = 0;

  // Extract first URL from a bio string
  function bioUrl(bio: string | null): string | null {
    if (!bio) return null;
    const m = bio.match(/https?:\/\/[^\s]+/);
    return m ? m[0] : null;
  }

  // Collect results so we can sort by confidence before printing
  const results: Array<{ lead: typeof leads[0]; result: Awaited<ReturnType<typeof lookupLeadInSalesforce>> }> = [];

  for (let i = 0; i < leads.length; i += CONCURRENCY) {
    const batch = leads.slice(i, i + CONCURRENCY);

    await Promise.all(batch.map(async (lead) => {
      try {
        const result = await lookupLeadInSalesforce({
          displayName: lead.name,
          igUsername:  lead.ig_username,
          externalUrl: bioUrl(lead.bio),
        });

        await supabase.from("leads").update({
          sf_account_id:       result.sfAccountId,
          sf_account_name:     result.sfAccountName,
          sf_status:           result.sfStatus,
          sf_confidence_score: result.sfConfidenceScore,
          sf_match_reasons:    result.sfMatchReasons,
          sf_last_checked:     result.sfLastChecked,
        }).eq("id", lead.id);

        results.push({ lead, result });

        if (result.sfStatus === "customer") customers++;
        else if (result.sfStatus === "inactive") inactive++;
        else if (result.sfStatus === "prospect") prospects++;
        else none++;

      } catch (err) {
        console.error(`  ❌ Error on ${lead.ig_username}:`, (err as Error).message);
        errors++;
      }
    }));
  }

  // Print all results sorted by confidence score descending (highest match confidence first)
  results.sort((a, b) => b.result.sfConfidenceScore - a.result.sfConfidenceScore);

  for (const { lead, result } of results) {
    if (result.sfStatus === "none") continue; // print matches only; none = clean DM target

    const handle  = `@${(lead.ig_username ?? lead.name ?? "?").padEnd(28)}`;
    const badge   = result.sfStatus === "customer" ? "🟢 CUSTOMER"
                  : result.sfStatus === "inactive" ? "🟡 INACTIVE"
                  : "🔵 PROSPECT";
    const conf    = ` (${result.sfConfidenceScore}/100)`;
    const sfName  = result.sfAccountName ? ` — SF: "${result.sfAccountName}"` : "";
    const reasons = result.sfMatchReasons.length ? `\n       matched on: ${result.sfMatchReasons.join(" · ")}` : "";
    console.log(`  ${badge}${conf}  ${handle}${sfName}${reasons}`);
  }

  const noneCount = results.filter(r => r.result.sfStatus === "none").length;
  console.log(`\n  (+ ${noneCount} leads not in SF — prime DM targets, omitted for brevity)`);

  console.log(`
─────────────────────────────────────────────
🟢 Customers (already on FanBasis): ${customers}
🟡 Inactive (was on FanBasis):       ${inactive}
🔵 Prospects (in SF, not customer):  ${prospects}
⚪ Not in SF (prime DM targets):     ${none}
❌ Errors:                           ${errors}
─────────────────────────────────────────────
Total: ${leads.length}

✓ All results saved to Supabase. Filter by sf_status to segment your outreach.
  `);
}

main().catch((err) => { console.error(err); process.exit(1); });
