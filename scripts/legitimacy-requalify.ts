/**
 * Legitimacy requalify — stricter than the keyword requalifier. Cuts the
 * off-ICP clusters that slip through (trading/forex/crypto/betting, astrology/
 * tarot/manifestation/spiritual-healing, pure entertainers) while KEEPING every
 * real coach who sells an offer (biz/sales/agency/ecom AND fitness/relationship/
 * mindset coaches — they all take payments, so they're FanBasis ICP).
 *
 * Dry-run by default (prints what it WOULD DQ). Pass --apply to write stage=DQ.
 * Run: npx tsx --env-file=.env.local scripts/legitimacy-requalify.ts [--apply]
 */
import { createClient } from "@supabase/supabase-js";

const APPLY = process.argv.includes("--apply");

// Off-ICP clusters. Each entry: [reason, [phrases]]. Match = DQ.
const OFF_ICP: [string, string[]][] = [
  ["trading/forex/crypto/betting", [
    "day trader", "day trading", "trading group", "trading school", "trading & investing",
    "trading and investing", "forex", "$nq", "futures trader", "futures | ", "market structure",
    "sports bettor", "sports picks", "sports betting", "betting strategy", "betting system",
    "pumpfun", "altcoin", "crypto trader", "years in crypto", "bull market", "helping traders",
    "help traders", "traders reach", "traders to $", "scaling traders", "8 figure trader",
    "8-figure trader", "figure trader", "quant |", "regulated cta", " cta ", "options trader",
    "prop firm", "funded trader", "ict ", "smart money concepts", "faceless trading",
  ]],
  ["astrology/tarot/manifestation/spiritual-healing", [
    "astrology", "astrologer", "tarot", "manifestation", "manifesting", "medical intuitive",
    "energy healing", "energy healer", "reiki", "chakra", "kabbalah", "spiritual gangster",
    "psychic", "law of attraction", "awakening coach", "clairvoyant", "spiritual educator",
    "universal spiritual", "quantum healing", "akashic", "shaman", "moon ritual", "witch",
  ]],
  ["entertainer (no offer)", [
    "comedian", "stand-up comedy", "stand up comedy", "recording academy", "sagaftra",
    "pop artist", "recording artist", "grammy", "platinum record",
  ]],
];

function classify(bio: string): { dq: boolean; reason: string } {
  const b = ` ${bio.toLowerCase()} `;
  for (const [reason, phrases] of OFF_ICP) {
    const hit = phrases.find((p) => b.includes(p));
    if (hit) return { dq: true, reason: `${reason} — "${hit.trim()}"` };
  }
  return { dq: false, reason: "" };
}

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const { data: leads, error } = await supabase
    .from("leads")
    .select("id, name, ig_username, bio, follower_count")
    .neq("stage", "DQ")
    .order("follower_count", { ascending: false });
  if (error) { console.error("Supabase error:", error.message); process.exit(1); }
  if (!leads?.length) { console.log("No active leads."); return; }

  const dq: { id: string; handle: string; reason: string }[] = [];
  const byReason: Record<string, number> = {};
  for (const lead of leads) {
    const { dq: isDq, reason } = classify(lead.bio ?? "");
    if (isDq) {
      dq.push({ id: lead.id, handle: `@${lead.ig_username ?? lead.name ?? "?"}`, reason });
      const key = reason.split(" — ")[0];
      byReason[key] = (byReason[key] ?? 0) + 1;
    }
  }

  console.log(`\nLegitimacy requalify — ${leads.length} active leads reviewed (${APPLY ? "APPLYING" : "DRY RUN"})\n`);
  for (const d of dq) console.log(`  ✗ ${d.handle.padEnd(26)} — ${d.reason}`);
  console.log(`\n── by cluster ──`);
  for (const [k, n] of Object.entries(byReason)) console.log(`  ${n.toString().padStart(3)}  ${k}`);
  console.log(`\nWould DQ: ${dq.length}   Keep: ${leads.length - dq.length}   (of ${leads.length})`);

  if (APPLY && dq.length) {
    await Promise.all(dq.map((d) =>
      supabase.from("leads").update({ stage: "DQ", notes: `Legitimacy-DQ: ${d.reason}` }).eq("id", d.id)
    ));
    console.log(`\n✓ Applied — ${dq.length} leads set to stage=DQ (reversible; filter stage=DQ to review).`);
  } else if (!APPLY) {
    console.log(`\n(dry run — re-run with --apply to DQ these)`);
  }
}

main().catch((err) => { console.error(err); process.exit(1); });
