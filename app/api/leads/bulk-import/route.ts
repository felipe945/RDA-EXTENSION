import { type NextRequest } from "next/server";
import { z } from "zod";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { supabaseServer } from "@/lib/supabase";
import { scoreLead } from "@/lib/scoring";
import { inngest } from "@/lib/inngest";
import { inngestConfigured } from "@/lib/research-trigger";
import { getSupabaseErrorMessage } from "@/lib/supabaseError";

// POST /api/leads/bulk-import
// Bulk-create leads from a mapped CSV. Dedups on ig_username (DB-enforced by
// migration 012) and, as a nicety, on email within the org. New leads are scored
// with the shared scoreLead().
//
// OWNERSHIP: inserts default to the shared cold pool (owner_id = null) so any
// rep can work them. Pass assignToMe:true to claim them for the importer.
//
// Body: { leads: RawLead[], onConflict?: "skip"|"update", research?: boolean,
//         assignToMe?: boolean, dryRun?: boolean }
//   dryRun   -> returns { preview: {...} } and writes nothing.
//   research -> opt-in. Inserted leads get research_status "pending" and (when
//               Inngest is configured) one enqueue event each. We never fan out
//               direct fetches here — that would blast the Anthropic API. When
//               Inngest is unset the leads stay "pending" and the throttled
//               research-drain cron picks them up.

const rawLeadSchema = z.object({
  ig_username: z.string().optional().nullable(),
  name: z.string().optional().nullable(),
  email: z.string().optional().nullable(),
  phone: z.string().optional().nullable(),
  linkedin_url: z.string().optional().nullable(),
  external_url: z.string().optional().nullable(),
  twitter_username: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  source: z.string().optional().nullable(),
});

const bodySchema = z.object({
  leads: z.array(rawLeadSchema).min(1).max(5000),
  onConflict: z.enum(["skip", "update"]).default("skip"),
  research: z.boolean().default(false),
  assignToMe: z.boolean().default(false),
  dryRun: z.boolean().default(false),
});

type RawLead = z.infer<typeof rawLeadSchema>;

const VALID_SOURCES = new Set(["Manual", "IG", "LinkedIn", "Email", "SMS"]);

function clean(v: string | null | undefined): string | null {
  if (v == null) return null;
  const t = String(v).trim();
  return t.length ? t : null;
}

// Normalized view of a row: trimmed fields + the dedup keys.
type NormLead = {
  ig_username: string | null;
  name: string | null;
  email: string | null;
  phone: string | null;
  linkedin_url: string | null;
  external_url: string | null;
  twitter_username: string | null;
  notes: string | null;
  source: string;
  igKey: string | null;     // lower(ig_username), the DB dedup key
  emailKey: string | null;  // lower(email), secondary app-level dedup
};

function normalize(raw: RawLead): NormLead {
  const ig = clean(raw.ig_username)?.replace(/^@+/, "") || null;
  const email = clean(raw.email);
  const rawSource = clean(raw.source);
  const source = rawSource && VALID_SOURCES.has(rawSource) ? rawSource : "Manual";
  return {
    ig_username: ig,
    name: clean(raw.name),
    email,
    phone: clean(raw.phone),
    linkedin_url: clean(raw.linkedin_url),
    external_url: clean(raw.external_url),
    twitter_username: clean(raw.twitter_username)?.replace(/^@+/, "") || null,
    notes: clean(raw.notes),
    source,
    igKey: ig ? ig.toLowerCase() : null,
    emailKey: email ? email.toLowerCase() : null,
  };
}

// A row is importable if it carries at least one identity/contact field.
function isValid(n: NormLead): boolean {
  return !!(n.ig_username || n.name || n.email || n.phone);
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.orgId) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  const orgId = session.orgId;
  const ownerId = session.userId ?? null;

  const rawBody = await req.json().catch(() => null);
  const parsed = bodySchema.safeParse(rawBody);
  if (!parsed.success) {
    return Response.json(
      { error: "Invalid payload", details: parsed.error.flatten() },
      { status: 400 }
    );
  }
  const { leads, onConflict, research, assignToMe, dryRun } = parsed.data;
  // Pooled by default; claimed by the importer only when assignToMe is set.
  const insertOwnerId = assignToMe ? ownerId : null;
  const db = supabaseServer();

  // Normalize + split valid/invalid.
  const norm = leads.map(normalize);
  const valid = norm.filter(isValid);
  const invalidCount = norm.length - valid.length;

  // Pull existing dedup keys for this org so we can classify new vs existing.
  // Only the two keys are needed, not full rows.
  const { data: existingRows, error: fetchErr } = await db
    .from("leads")
    .select("id, ig_username, email")
    .eq("org_id", orgId);
  if (fetchErr) {
    return Response.json({ error: getSupabaseErrorMessage(fetchErr) }, { status: 500 });
  }

  const existingByIg = new Map<string, string>();   // igKey -> lead id
  const existingByEmail = new Map<string, string>(); // emailKey -> lead id
  for (const r of existingRows ?? []) {
    const ig = (r.ig_username as string | null)?.toLowerCase();
    if (ig && !existingByIg.has(ig)) existingByIg.set(ig, r.id as string);
    const em = (r.email as string | null)?.toLowerCase();
    if (em && !existingByEmail.has(em)) existingByEmail.set(em, r.id as string);
  }

  const matchExisting = (n: NormLead): string | null =>
    (n.igKey && existingByIg.get(n.igKey)) ||
    (n.emailKey && existingByEmail.get(n.emailKey)) ||
    null;

  // Classify, collapsing duplicates within the uploaded batch itself.
  const seenIg = new Set<string>();
  const seenEmail = new Set<string>();
  const toInsert: NormLead[] = [];
  const toUpdate: { id: string; n: NormLead }[] = [];
  let existingCount = 0;
  let dupInBatch = 0;

  for (const n of valid) {
    const existingId = matchExisting(n);
    if (existingId) {
      existingCount++;
      if (onConflict === "update") toUpdate.push({ id: existingId, n });
      continue;
    }
    // Not in DB — has it already appeared earlier in this same file?
    const dupHere =
      (n.igKey && seenIg.has(n.igKey)) || (n.emailKey && seenEmail.has(n.emailKey));
    if (dupHere) {
      dupInBatch++;
      continue;
    }
    if (n.igKey) seenIg.add(n.igKey);
    if (n.emailKey) seenEmail.add(n.emailKey);
    toInsert.push(n);
  }

  if (dryRun) {
    return Response.json({
      preview: {
        new: toInsert.length,
        existing: existingCount,
        invalid: invalidCount,
        duplicateInFile: dupInBatch,
        total: norm.length,
      },
    });
  }

  const nowIso = new Date().toISOString();
  const dueIso = new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString();
  const errors: string[] = [];

  // --- Updates (onConflict === "update") ---
  let updated = 0;
  for (const { id, n } of toUpdate) {
    const patch: Record<string, unknown> = { updated_at: nowIso };
    if (n.name) patch.name = n.name;
    if (n.email) patch.email = n.email;
    if (n.phone) patch.phone = n.phone;
    if (n.linkedin_url) patch.linkedin_url = n.linkedin_url;
    if (n.external_url) patch.external_url = n.external_url;
    if (n.twitter_username) patch.twitter_username = n.twitter_username;
    if (n.notes) patch.notes = n.notes;
    const { error } = await db.from("leads").update(patch).eq("id", id);
    if (error) errors.push(`update ${n.ig_username ?? n.email ?? id}: ${getSupabaseErrorMessage(error)}`);
    else updated++;
  }

  // --- Inserts ---
  const rows = toInsert.map((n) => ({
    ig_username: n.ig_username,
    name: n.name ?? n.ig_username,
    email: n.email,
    phone: n.phone,
    linkedin_url: n.linkedin_url,
    external_url: n.external_url,
    twitter_username: n.twitter_username,
    notes: n.notes,
    source: n.source,
    mode: "sales" as const,
    stage: "New" as const,
    org_id: orgId,
    owner_id: insertOwnerId,
    due_at: dueIso,
    updated_at: nowIso,
    research_status: research ? "pending" : "none",
    score: scoreLead({
      bio: undefined,
      externalUrl: n.external_url ?? undefined,
    }),
  }));

  const insertedIds: string[] = [];
  const CHUNK = 500;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const chunk = rows.slice(i, i + CHUNK);
    const { data, error } = await db.from("leads").insert(chunk).select("id");
    if (error) {
      // Chunk failed (likely a unique-index race). Retry row-by-row so one bad
      // row doesn't sink the whole batch; genuine dup violations count as skipped.
      for (const one of chunk) {
        const { data: d1, error: e1 } = await db.from("leads").insert(one).select("id").maybeSingle();
        if (e1) {
          if (!/duplicate key|unique constraint/i.test(e1.message ?? "")) {
            errors.push(`insert ${one.ig_username ?? one.email ?? "?"}: ${getSupabaseErrorMessage(e1)}`);
          }
        } else if (d1?.id) {
          insertedIds.push(d1.id as string);
        }
      }
    } else {
      for (const d of data ?? []) insertedIds.push(d.id as string);
    }
  }

  // --- Opt-in research. Enqueue via Inngest when configured; otherwise leave
  // the leads research_status="pending" for the throttled research-drain cron.
  // We deliberately never fan out direct fetches here (that would blast the
  // Anthropic API for a large CSV). ---
  let researchQueued = 0;
  if (research && insertedIds.length && inngestConfigured()) {
    try {
      await inngest.send(
        insertedIds.map((leadId) => ({ name: "lead/research.requested", data: { leadId } }))
      );
      researchQueued = insertedIds.length;
    } catch (err) {
      console.error("bulk-import: inngest.send failed; leads left pending for the drain", err);
    }
  }

  return Response.json({
    ok: true,
    inserted: insertedIds.length,
    updated,
    skipped: existingCount - updated + dupInBatch,
    invalid: invalidCount,
    total: norm.length,
    researchQueued,
    errors,
  });
}
