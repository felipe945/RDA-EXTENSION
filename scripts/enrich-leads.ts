/**
 * Lead enrichment — finds LinkedIn, Twitter, email, YouTube, and website
 * for every lead that passed requalify AND is NOT in Salesforce.
 *
 * Uses EXISTING columns only (no migration needed):
 *   email, linkedin_url, twitter_username, external_url (website),
 *   research_cache.youtube_url + research_cache.enriched_at (JSONB merge)
 *
 * Also cross-references messages table + dm_sent_at to flag already-contacted leads.
 *
 * Batches ALL Google queries into a small number of Apify runs (efficient).
 *
 * Run: npx tsx --env-file=.env.local scripts/enrich-leads.ts
 * Options:
 *   --force     Re-enrich leads that already have enrichment data
 *   --limit N   Only process first N leads (e.g. --limit 20 to test)
 *   --no-save   Dry run — print results without writing to Supabase
 */
import { createClient } from "@supabase/supabase-js";

const APIFY_TOKEN       = process.env.APIFY_TOKEN!;
const QUERIES_PER_BATCH = 50; // google-search-scraper handles ~50 safely per run
const BATCH_CONCURRENCY = 2;  // 2 Apify runs in parallel

const cliArgs = process.argv.slice(2);
const FORCE   = cliArgs.includes("--force");
const NO_SAVE = cliArgs.includes("--no-save");
const limitIdx = cliArgs.indexOf("--limit");
const LIMIT   = limitIdx !== -1 ? parseInt(cliArgs[limitIdx + 1], 10) : Infinity;

// ─── Types ────────────────────────────────────────────────────────────────────

interface Lead {
  id: string;
  name: string | null;
  ig_username: string | null;
  bio: string | null;
  email: string | null;
  linkedin_url: string | null;
  twitter_username: string | null;
  external_url: string | null;
  follower_count: number | null;
  dm_sent_at: string | null;
  research_cache: Record<string, unknown> | null;
}

interface FlatResult { query: string; title: string; url: string; description: string }
type QueryType = "li" | "tw" | "em" | "yt";

// ─── Apify batch Google search ────────────────────────────────────────────────

async function batchGoogleSearch(queries: string[]): Promise<FlatResult[]> {
  const res = await fetch(
    `https://api.apify.com/v2/acts/apify~google-search-scraper/run-sync-get-dataset-items?token=${APIFY_TOKEN}&timeout=120`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        queries:          queries.join("\n"),
        maxPagesPerQuery: 1,
        resultsPerPage:   5,
        languageCode:     "en",
        countryCode:      "us",
      }),
    }
  );

  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`[apify] HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }

  type RawItem = {
    searchQuery?: { term?: string } | string;
    organicResults?: { title?: string; url?: string; description?: string }[];
    title?: string;
    url?: string;
    description?: string;
  };

  const items = (await res.json()) as RawItem[];
  const flat: FlatResult[] = [];

  for (const item of items) {
    const q = typeof item.searchQuery === "object"
      ? (item.searchQuery?.term ?? "")
      : (item.searchQuery ?? "");

    if (Array.isArray(item.organicResults)) {
      item.organicResults.forEach((r) =>
        flat.push({ query: q, title: r.title ?? "", url: r.url ?? "", description: r.description ?? "" })
      );
    } else if (item.url) {
      flat.push({ query: q, title: item.title ?? "", url: item.url, description: item.description ?? "" });
    }
  }
  return flat;
}

// ─── Extractors ───────────────────────────────────────────────────────────────

function extractLinkedIn(results: FlatResult[]): string | null {
  for (const r of results) {
    const m = r.url.match(/linkedin\.com\/in\/([a-zA-Z0-9\-_%]+)/);
    if (m) return `https://www.linkedin.com/in/${m[1].replace(/%2F.*$/, "")}`;
  }
  return null;
}

function extractTwitterHandle(results: FlatResult[]): string | null {
  for (const r of results) {
    const m = r.url.match(/(?:twitter\.com|x\.com)\/([a-zA-Z0-9_]+)/);
    if (m && !["search", "hashtag", "intent", "i", "explore", "home"].includes(m[1])) {
      return m[1];
    }
  }
  return null;
}

function extractEmail(results: FlatResult[]): string | null {
  const emailRe = /[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}/;
  for (const r of results) {
    const m = r.title.match(emailRe) ?? r.description.match(emailRe);
    if (m) return m[0].toLowerCase();
  }
  return null;
}

function extractYouTube(results: FlatResult[]): string | null {
  for (const r of results) {
    const m = r.url.match(/youtube\.com\/(@?[a-zA-Z0-9_\-]+)/);
    if (m && !["watch", "results", "playlist", "c", "channel", "user", "shorts"].includes(m[1])) {
      const handle = m[1].startsWith("@") ? m[1] : `@${m[1]}`;
      return `https://www.youtube.com/${handle}`;
    }
  }
  return null;
}

function extractWebsite(results: FlatResult[], igUsername: string | null, name: string): string | null {
  const nameParts = name.toLowerCase().split(/\s+/).filter((p) => p.length > 3);
  const noise = /instagram|twitter|x\.com|facebook|linkedin|youtube|tiktok|wikipedia|yelp|glassdoor|trustpilot|linktr\.ee/;

  for (const r of results) {
    const url = r.url.toLowerCase();
    if (noise.test(url)) continue;
    if (nameParts.some((p) => url.includes(p))) return r.url;
    if (igUsername && url.includes(igUsername.toLowerCase())) return r.url;
  }
  // fallback: first non-social result
  for (const r of results) {
    if (!noise.test(r.url.toLowerCase())) return r.url;
  }
  return null;
}

// ─── Query tagging — lets us map batch results back to individual leads ────────

function tagQuery(leadId: string, type: QueryType, q: string): string {
  return `${q} /* ${leadId}:${type} */`;
}

function rawQuery(tagged: string): string {
  return tagged.replace(/\s*\/\*[^*]+\*\/\s*$/, "");
}

function parseTag(tagged: string): { leadId: string; type: QueryType } | null {
  const m = tagged.match(/\/\*\s*([^:]+):([a-z]+)\s*\*\/$/);
  if (!m) return null;
  return { leadId: m[1].trim(), type: m[2] as QueryType };
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  if (!APIFY_TOKEN) { console.error("APIFY_TOKEN not set"); process.exit(1); }

  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  // 1. Pull non-DQ, non-SF leads
  const { data: allLeads, error } = await supabase
    .from("leads")
    .select("id, name, ig_username, bio, email, linkedin_url, twitter_username, external_url, follower_count, dm_sent_at, research_cache")
    .neq("stage", "DQ")
    .eq("sf_status", "none")
    .eq("mode", "sales")
    .order("follower_count", { ascending: false });

  if (error) { console.error("Supabase error:", error.message); process.exit(1); }
  if (!allLeads?.length) {
    console.log("\nNo qualifying leads found. Run requalify-leads.ts + sf-lookup-all.ts first.");
    return;
  }

  // Filter to unenriched unless --force
  const leads: Lead[] = FORCE
    ? allLeads
    : allLeads.filter((l) => !(l.research_cache as Record<string, unknown> | null)?.enriched_at);

  const target = LIMIT < leads.length ? leads.slice(0, LIMIT) : leads;

  console.log(`\nTotal non-SF leads in DB: ${allLeads.length}`);
  console.log(`Already enriched (skipping): ${allLeads.length - leads.length}`);
  console.log(`To enrich now: ${target.length}${LIMIT < leads.length ? ` (--limit ${LIMIT})` : ""}`);
  if (NO_SAVE) console.log("  DRY RUN — results will not be saved");

  // 2. Check who's already been messaged
  const targetIds = target.map((l) => l.id);
  const { data: msgRows } = await supabase
    .from("messages")
    .select("lead_id")
    .eq("direction", "outbound")
    .in("lead_id", targetIds);

  const alreadyMessaged = new Set([
    ...(msgRows ?? []).map((r: { lead_id: string }) => r.lead_id),
    ...target.filter((l) => !!l.dm_sent_at).map((l) => l.id),
  ]);
  console.log(`Already messaged (flagged, not excluded from enrichment): ${alreadyMessaged.size}\n`);

  // 3. Build tagged query list (skip fields we already have)
  const taggedQueries: string[] = [];
  for (const lead of target) {
    const n    = lead.name ?? lead.ig_username ?? "";
    const nameQ = `"${n}"`;
    const h     = lead.ig_username ? `"${lead.ig_username}"` : nameQ;

    if (!lead.linkedin_url)     taggedQueries.push(tagQuery(lead.id, "li", `${nameQ} linkedin`));
    if (!lead.twitter_username) taggedQueries.push(tagQuery(lead.id, "tw", `${h} twitter OR x.com`));
    if (!lead.email)            taggedQueries.push(tagQuery(lead.id, "em", `${nameQ} email contact`));
    taggedQueries.push(tagQuery(lead.id, "yt", `${h} youtube channel`));
  }

  const totalBatches = Math.ceil(taggedQueries.length / QUERIES_PER_BATCH);
  console.log(`Google searches to run: ${taggedQueries.length} across ${totalBatches} batches`);
  console.log(`Estimated time: ~${Math.ceil(totalBatches / BATCH_CONCURRENCY) * 2}–${Math.ceil(totalBatches / BATCH_CONCURRENCY) * 4} minutes\n`);

  // 4. Run batches and map results by leadId → type → FlatResult[]
  const resultMap = new Map<string, Map<QueryType, FlatResult[]>>();

  for (let b = 0; b < totalBatches; b += BATCH_CONCURRENCY) {
    const batchGroup: { index: number; tagged: string[] }[] = [];
    for (let k = 0; k < BATCH_CONCURRENCY && b + k < totalBatches; k++) {
      const start = (b + k) * QUERIES_PER_BATCH;
      batchGroup.push({
        index: b + k + 1,
        tagged: taggedQueries.slice(start, start + QUERIES_PER_BATCH),
      });
    }

    const label = batchGroup.map((x) => x.index).join("+");
    process.stdout.write(`  Batch ${label}/${totalBatches} (${batchGroup.reduce((s, x) => s + x.tagged.length, 0)} queries)... `);

    const batchResults = await Promise.allSettled(
      batchGroup.map(({ tagged }) => batchGoogleSearch(tagged.map(rawQuery)))
    );

    for (let k = 0; k < batchGroup.length; k++) {
      const { tagged } = batchGroup[k];
      const r = batchResults[k];
      if (r.status === "rejected") {
        console.warn(`\n  ⚠ Batch ${batchGroup[k].index} failed: ${r.reason}`);
        continue;
      }

      const flatResults = r.value;

      // Map each result back to its lead using query text matching
      for (const tagged_q of tagged) {
        const tag = parseTag(tagged_q);
        if (!tag) continue;
        const { leadId, type } = tag;
        const qText = rawQuery(tagged_q);

        const matches = flatResults.filter(
          (fr) => fr.query === qText || fr.query.includes(qText.slice(0, 30))
        );

        if (!resultMap.has(leadId)) resultMap.set(leadId, new Map());
        const typeMap = resultMap.get(leadId)!;
        typeMap.set(type, [...(typeMap.get(type) ?? []), ...matches]);
      }
    }

    console.log(`done`);
  }

  // 5. Extract enrichment per lead and write to Supabase
  console.log(`\nSaving enrichment to Supabase...\n`);

  let enriched = 0, failed = 0, alreadyHad = 0;

  const finalList: Array<{
    name: string; igUsername: string | null; followers: number;
    linkedin: string | null; twitter: string | null; email: string | null;
    youtube: string | null; website: string | null; messaged: boolean;
  }> = [];

  for (const lead of target) {
    const typeMap = resultMap.get(lead.id) ?? new Map<QueryType, FlatResult[]>();
    const n = lead.name ?? lead.ig_username ?? "";

    const linkedin = lead.linkedin_url ?? extractLinkedIn(typeMap.get("li") ?? []);
    const twitter  = lead.twitter_username ?? extractTwitterHandle(typeMap.get("tw") ?? []);
    const email    = lead.email ?? extractEmail(typeMap.get("em") ?? []);
    const youtube  = extractYouTube(typeMap.get("yt") ?? []);
    const allRes   = [...(typeMap.get("li") ?? []), ...(typeMap.get("tw") ?? [])];
    const website  = lead.external_url ?? extractWebsite(allRes, lead.ig_username, n);

    const found: string[] = [];
    if (linkedin) found.push("LI");
    if (twitter)  found.push("TW");
    if (email)    found.push("EM");
    if (youtube)  found.push("YT");
    if (website)  found.push("WEB");

    if (!NO_SAVE) {
      // Merge enrichment into existing research_cache (don't wipe fit scores etc.)
      const existingCache = (lead.research_cache ?? {}) as Record<string, unknown>;
      const mergedCache = {
        ...existingCache,
        youtube_url:  youtube,
        enriched_at:  new Date().toISOString(),
      };

      const { error: upErr } = await supabase.from("leads").update({
        linkedin_url:     linkedin,
        twitter_username: twitter,
        email:            email,
        external_url:     website,
        research_cache:   mergedCache,
      }).eq("id", lead.id);

      if (upErr) {
        console.error(`  ❌ @${lead.ig_username ?? n}: ${upErr.message}`);
        failed++;
        continue;
      }
    }

    if (found.length > 0) enriched++;
    else alreadyHad++;

    finalList.push({
      name:       n,
      igUsername: lead.ig_username,
      followers:  lead.follower_count ?? 0,
      linkedin,
      twitter,
      email,
      youtube,
      website,
      messaged: alreadyMessaged.has(lead.id),
    });
  }

  // 6. Print outreach-ready list
  const notMessaged = finalList.filter((r) => !r.messaged);
  const messaged    = finalList.filter((r) => r.messaged);

  // Sort by richness of enrichment (most channels found first)
  const richness = (r: typeof notMessaged[0]) =>
    [r.linkedin, r.twitter, r.email, r.youtube, r.website].filter(Boolean).length;
  notMessaged.sort((a, b) => richness(b) - richness(a) || b.followers - a.followers);

  console.log("\n" + "═".repeat(90));
  console.log(`OUTREACH-READY PROSPECTS  —  Not in SF, not yet messaged (${notMessaged.length})`);
  console.log("═".repeat(90));

  for (const r of notMessaged) {
    const lines: string[] = [];
    if (r.igUsername) lines.push(`  IG  instagram.com/${r.igUsername}`);
    if (r.linkedin)   lines.push(`  LI  ${r.linkedin}`);
    if (r.twitter)    lines.push(`  TW  x.com/${r.twitter}`);
    if (r.email)      lines.push(`  EM  ${r.email}`);
    if (r.youtube)    lines.push(`  YT  ${r.youtube}`);
    if (r.website)    lines.push(`  WEB ${r.website}`);

    console.log(`\n${r.name}  (${r.followers.toLocaleString()} followers)`);
    if (lines.length) console.log(lines.join("\n"));
    else console.log("  (no enrichment found — DM on IG directly)");
  }

  if (messaged.length > 0) {
    console.log("\n" + "─".repeat(90));
    console.log(`ALREADY CONTACTED — excluded from outreach list (${messaged.length}):`);
    messaged.forEach((r) =>
      console.log(`  @${(r.igUsername ?? r.name).padEnd(30)} has outbound record`)
    );
  }

  console.log("\n" + "═".repeat(90));
  console.log(`
Summary
─────────────────────────────────────────
  Total non-SF leads:    ${allLeads.length}
  Processed this run:    ${target.length}
  New data found:        ${enriched}
  No new data (kept):    ${alreadyHad}
  Save errors:           ${failed}

  ⚪ Outreach-ready (not messaged): ${notMessaged.length}
  📨 Already DMed (skip):           ${messaged.length}

Channels stored in Supabase:
  email, linkedin_url, twitter_username, external_url (website), research_cache.youtube_url
  `);
}

main().catch((err) => { console.error(err); process.exit(1); });
