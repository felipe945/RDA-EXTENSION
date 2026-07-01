/**
 * One-time migration: adds enrichment columns to the leads table.
 * Safe to re-run — uses IF NOT EXISTS.
 *
 * Run: npx tsx --env-file=.env.local scripts/migrate-enrichment-cols.ts
 */
import { createClient } from "@supabase/supabase-js";

async function main() {
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

  const migrations = [
    `alter table leads add column if not exists twitter_username text`,
    `alter table leads add column if not exists youtube_url      text`,
    `alter table leads add column if not exists website_url      text`,
    `alter table leads add column if not exists enriched_at      timestamptz`,
    `create index if not exists leads_sf_status on leads(sf_status)`,
    `create index if not exists leads_enriched_at on leads(enriched_at)`,
  ];

  console.log("\nRunning enrichment column migrations...\n");

  for (const sql of migrations) {
    const { error } = await supabase.rpc("exec_sql", { sql }).single();
    if (error) {
      // exec_sql RPC may not exist — use raw query via REST instead
      const res = await fetch(
        `${process.env.NEXT_PUBLIC_SUPABASE_URL}/rest/v1/rpc/exec_sql`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: process.env.SUPABASE_SERVICE_ROLE_KEY!,
            Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY!}`,
          },
          body: JSON.stringify({ sql }),
        }
      );
      if (!res.ok) {
        console.warn(`  ⚠ Could not run via RPC: ${sql.slice(0, 60)}`);
        console.warn(`    Run this manually in Supabase SQL editor`);
        continue;
      }
    }
    console.log(`  ✓ ${sql.slice(0, 70)}`);
  }

  console.log("\nMigration complete. If any lines showed ⚠, run them in Supabase SQL editor:");
  migrations.forEach((s) => console.log(`  ${s};`));
}

main().catch((err) => { console.error(err); process.exit(1); });
