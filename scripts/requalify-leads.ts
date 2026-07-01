/**
 * Fast keyword-based lead requalifier — no AI API needed.
 * DQs obvious non-coaches (musicians, entertainers, brands, athletes)
 * and keeps anyone with real coaching/selling signals.
 *
 * Run: npx tsx --env-file=.env.local scripts/requalify-leads.ts
 */
import { createClient } from "@supabase/supabase-js";

// Hard disqualifiers — if bio contains any of these AND no coaching signal, DQ
const DQ_KEYWORDS = [
  "musician", "music artist", "singer", "rapper", "hip hop", "r&b",
  "recording artist", "grammy", "platinum record", "album", "tour dates",
  "actor", "actress", "filmmaker", "director", "producer", "on-screen",
  "comedian", "stand-up", "comedy",
  "athlete", "nba player", "mlb player", "nhl player", "olympic athlete",
  "model", "fashion model",
  "journalist", "reporter", "anchor", "news",
  "politician", "senator", "congressman", "mayor",
];

// Strong coaching/selling signals — if ANY of these appear, always keep
const STRONG_KEEP = [
  "coach", "coaching", "mentor", "mentoring",
  "i help", "we help", "helping you", "helping people",
  "dm me", "dm \"", "apply now", "applications open",
  "course", "program", "mastermind", "academy",
  "clients", "client results", "student results",
  "consultant", "agency owner", "smma",
  "lead gen", "lead generation",
  "trainer", "training program",
  "enroll", "enrollment",
  "6 figure", "7 figure", "8 figure",
  "high ticket", "closer", "setter",
];

function classify(bio: string): { qualified: boolean; reason: string } {
  const b = bio.toLowerCase();

  // Always keep if strong coaching signal present
  const keepSignal = STRONG_KEEP.find((kw) => b.includes(kw));
  if (keepSignal) return { qualified: true, reason: `has "${keepSignal}"` };

  // DQ if obvious non-coach signal
  const dqSignal = DQ_KEYWORDS.find((kw) => b.includes(kw));
  if (dqSignal) return { qualified: false, reason: `non-coach signal: "${dqSignal}"` };

  // No bio at all — keep (can review manually)
  if (!bio.trim()) return { qualified: true, reason: "no bio — kept for manual review" };

  // Borderline — keep but flag
  return { qualified: true, reason: "no clear signal — kept for review" };
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, name, ig_username, bio, follower_count, stage")
    .neq("stage", "DQ")
    .order("created_at", { ascending: true });

  if (error) { console.error("Supabase error:", error.message); process.exit(1); }
  if (!leads?.length) { console.log("No leads to requalify."); return; }

  console.log(`\nRequalifying ${leads.length} leads (keyword-based, instant)...\n`);

  let kept = 0, dqd = 0;
  const dqIds: { id: string; reason: string }[] = [];

  for (const lead of leads) {
    const { qualified, reason } = classify(lead.bio ?? "");
    const handle = `@${(lead.ig_username ?? lead.name ?? "?").padEnd(28)}`;

    if (!qualified) {
      dqIds.push({ id: lead.id, reason });
      console.log(`  ✗ DQ  ${handle} — ${reason}`);
      dqd++;
    } else {
      kept++;
    }
  }

  // Bulk update DQ'd leads
  if (dqIds.length > 0) {
    await Promise.all(
      dqIds.map(({ id, reason }) =>
        supabase.from("leads").update({ stage: "DQ", notes: `Auto-DQ: ${reason}` }).eq("id", id)
      )
    );
  }

  console.log(`\n─────────────────────────────────`);
  console.log(`✓ Kept:         ${kept}`);
  console.log(`✗ Disqualified: ${dqd}`);
  console.log(`Total reviewed: ${leads.length}`);
  console.log(`\nDQ'd leads are still in Supabase with stage=DQ if you want to review them.`);
}

main().catch((err) => { console.error(err); process.exit(1); });
