/**
 * One-time explorer — lists Metabase databases, tables, and saved questions
 * so we know what seller data is available to query.
 *
 * Run: npx tsx --env-file=.env.local scripts/metabase-explore.ts
 */

const MB_URL  = process.env.METABASE_URL!;
const MB_USER = process.env.METABASE_USERNAME!;
const MB_PASS = process.env.METABASE_PASSWORD!;

async function mbAuth(): Promise<string> {
  const res = await fetch(`${MB_URL}/api/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: MB_USER, password: MB_PASS }),
  });
  if (!res.ok) throw new Error(`Metabase auth failed: HTTP ${res.status}`);
  const { id } = await res.json() as { id: string };
  return id;
}

async function mbGet(token: string, path: string) {
  const res = await fetch(`${MB_URL}${path}`, {
    headers: { "X-Metabase-Session": token },
  });
  if (!res.ok) throw new Error(`Metabase GET ${path} failed: HTTP ${res.status}`);
  return res.json();
}

async function main() {
  console.log("\nAuthenticating with Metabase...");
  const token = await mbAuth();
  console.log("✓ Auth OK\n");

  // List databases
  const dbs = await mbGet(token, "/api/database") as { data: { id: number; name: string; engine: string }[] };
  console.log("=== DATABASES ===");
  const dbList = dbs.data ?? (dbs as unknown as { id: number; name: string; engine: string }[]);
  for (const db of dbList) {
    console.log(`  [${db.id}] ${db.name} (${db.engine})`);
  }

  // List tables for each database
  console.log("\n=== TABLES ===");
  for (const db of dbList) {
    try {
      const meta = await mbGet(token, `/api/database/${db.id}/metadata`) as {
        tables: { id: number; name: string; schema: string }[]
      };
      const tables = meta.tables ?? [];
      if (tables.length) {
        console.log(`\n  DB: ${db.name}`);
        tables.forEach(t => console.log(`    [${t.id}] ${t.schema ? t.schema + "." : ""}${t.name}`));
      }
    } catch (e) {
      console.log(`  (could not fetch tables for ${db.name})`);
    }
  }

  // List saved questions (cards) — look for anything seller/account related
  console.log("\n=== SAVED QUESTIONS (seller/account/user related) ===");
  const cards = await mbGet(token, "/api/card") as { id: number; name: string; database_id: number }[];
  const relevant = cards.filter(c =>
    /seller|account|merchant|user|customer|creator|payment|payout|onboard/i.test(c.name)
  );
  if (relevant.length) {
    relevant.forEach(c => console.log(`  [${c.id}] ${c.name}`));
  } else {
    console.log("  (no obvious matches — showing all questions)");
    cards.slice(0, 30).forEach(c => console.log(`  [${c.id}] ${c.name}`));
  }
}

main().catch(err => { console.error(err.message); process.exit(1); });
