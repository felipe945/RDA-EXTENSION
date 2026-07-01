# T4 — Performance, API Hardening & Research Pipeline
## Files Owned
- `hooks/useLeads.ts`
- `app/api/leads/route.ts` (GET + PATCH)
- `app/api/ai/research-lead/route.ts`
- `lib/scoring.ts`
- `lib/claude.ts`

## Do NOT touch
- `components/*` (owned by T3)
- `app/outreach/page.tsx` (owned by T2)
- `app/api/messages/route.ts` (owned by T2)

---

## Context
Four categories of issues:
1. **Double-fetching in useLeads** — 8s poll + Supabase realtime both call `load()`, fetching the entire lead list twice as often as needed
2. **PATCH does 2 DB round trips** — SELECT current lead for scoring inputs, then UPDATE
3. **research-lead has a critical bug** — `crossPlatformCandidates` is ALWAYS NULL (a `Promise.resolve(null)` placeholder was left in instead of the real call)
4. **research-lead fire-and-forget URL** uses `process.env.VERCEL_URL` which is the deployment subdomain, not the custom domain — breaks on production

---

## FIX 1: useLeads — Remove Redundant 8-Second Poll
**Problem:** `useLeads` runs `setInterval(load, 8000)` AND subscribes to Supabase realtime. Every DB change fires realtime AND the 8s poll fires too. Double fetches constantly.

**Root cause:** `hooks/useLeads.ts` — the `useEffect` that returns `clearInterval(poll)` + `db.removeChannel(channel)`

**Fix:** Increase poll to 30 seconds (for genuine cases where realtime misses something) and debounce the realtime callback so rapid successive changes don't fire 10 fetches:

```typescript
export function useLeads(mode: "sales" | "csm") {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/leads?mode=${mode}`);
    if (!res.ok) return;
    const { leads: data } = await res.json() as { leads: Record<string, unknown>[] };
    setLeads((data ?? []).map(normalizeLead));
    setLoading(false);
  }, [mode]);

  const debouncedLoad = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { load(); }, 300);
  }, [load]);

  useEffect(() => {
    load();

    // Poll every 30s (fallback for missed realtime events)
    const poll = setInterval(load, 30_000);

    // Supabase realtime — filter to mode to reduce noise
    const db = getSupabase();
    const channel = db
      .channel(`leads-${mode}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `mode=eq.${mode}` },
        debouncedLoad
      )
      .subscribe();

    return () => {
      clearInterval(poll);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      db.removeChannel(channel);
    };
  }, [mode, load, debouncedLoad]);

  return { leads, loading, refresh: load };
}
```

Also add `useRef` to imports: `import { useEffect, useState, useCallback, useRef } from "react";`

---

## FIX 2: useLeads — Add twitter_username, external_url to normalization
**Note:** These fields exist in the DB (migrations 003, 004) but are missing from the Lead type and normalization. T5 handles `lib/types.ts`; you handle the `normalizeLead` function in `useLeads.ts` and the Lead type in `useLeads.ts`.

Add to the `Lead` type in `useLeads.ts`:
```typescript
twitter_username: string | null;
external_url: string | null;
ig_user_id: string | null;
sent_from_handle?: string | null;   // for messages — not on Lead but keep in mind
```

Add to `normalizeLead`:
```typescript
twitter_username: (raw.twitter_username as string | null) ?? null,
external_url:     (raw.external_url as string | null) ?? null,
ig_user_id:       (raw.ig_user_id as string | null) ?? null,
```

---

## FIX 3: /api/leads GET — Add Search Param
**Problem:** No `?search=text` support. Text search is client-side only (T3 does it in Dashboard state), but for large datasets we want server-side too.

**Location:** `app/api/leads/route.ts` GET handler

Add after the existing `searchParams.get("ig_username")` block:
```typescript
const searchQuery = searchParams.get("search");
// ... after existing query filters:
if (searchQuery && searchQuery.trim()) {
  const q = `%${searchQuery.trim().toLowerCase()}%`;
  query = query.or(`ig_username.ilike.${q},name.ilike.${q},email.ilike.${q},phone.ilike.${q}`);
}
```

---

## FIX 4: /api/leads PATCH — Remove Double DB Round Trip
**Problem:** PATCH handler does `SELECT` to get current lead, merges fields, recomputes score, then does `UPDATE`. Two round trips per save.  
**Location:** `app/api/leads/route.ts` PATCH handler, the block starting with `const { data: current } = await db.from("leads").select(...)`

**Fix:** Use the PATCH body fields directly for scoring. If `research_cache` is not in the PATCH body, don't re-fetch it — just use what's passed:

```typescript
export async function PATCH(request: NextRequest) {
  const db = supabaseServer();
  let body: Record<string, unknown>;
  try {
    body = await request.json() as Record<string, unknown>;
  } catch {
    return Response.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { id, ...fields } = body;
  if (!id || typeof id !== "string") {
    return Response.json({ error: "Missing id" }, { status: 400 });
  }

  // Only re-fetch for scoring if scoring-relevant fields are NOT in the PATCH body
  // (e.g., pure stage changes don't need a SELECT)
  const needsScoreRecompute = ["bio", "follower_count", "ig_profile_url", "research_cache"]
    .some(k => k in fields);

  let score: number | undefined;
  if (needsScoreRecompute) {
    // Fetch only the fields needed for scoring — one light SELECT
    const { data: current } = await db
      .from("leads")
      .select("bio, follower_count, ig_profile_url, research_cache")
      .eq("id", id)
      .single();
    const merged = { ...(current ?? {}), ...fields };
    score = scoreLead({
      bio: merged.bio as string | undefined,
      followerCount: merged.follower_count as number | undefined,
      externalUrl: merged.ig_profile_url as string | undefined,
      researchCache: merged.research_cache as Record<string, unknown> | undefined,
    });
  }

  const updatePayload: Record<string, unknown> = {
    ...fields,
    updated_at: new Date().toISOString(),
  };
  if (score !== undefined) updatePayload.score = score;

  const { data, error } = await db
    .from("leads")
    .update(updatePayload)
    .eq("id", id)
    .select()
    .single();

  if (error) return Response.json({ error: error.message }, { status: 500 });
  return Response.json({ lead: data });
}
```

This eliminates the SELECT on pure stage/note/due_at changes (the most common PATCHes).

---

## FIX 5: research-lead — Fix crossPlatformCandidates Always Null
**Problem:** `app/api/ai/research-lead/route.ts` — first `Promise.all` has a placeholder `Promise.resolve(null as null)` that's destructured as `crossPlatformCandidates`, but the real `findCrossPlatformHandles` is in the SECOND `Promise.all`. The variable `crossPlatformCandidates` from the destructure is null and immediately voided.

**Root cause:** Lines ~35-45 in research-lead/route.ts:
```typescript
const [apify, crossPlatformCandidates] = await Promise.all([
  igUsername ? fetchIgProfile(igUsername) : Promise.resolve(null),
  Promise.resolve(null as null),  // ← BUG: placeholder, never gets real data
]);
// ...
const [candidates, sfMatch] = await Promise.all([
  findCrossPlatformHandles({ ... }),
  lookupLeadInSalesforce({ ... }),
]);
void crossPlatformCandidates; // ← discarded
```

**Fix:** Restructure to run ALL three in true parallel once we have `externalUrl`. We need `apify` first to get `externalUrl`, then we can fan out. The only real dependency is `externalUrl` from Apify:

```typescript
// Step 2: Run Apify first to get externalUrl (needed for cross-platform + SF)
const apify = igUsername ? await fetchIgProfile(igUsername) : null;
const externalUrl = apify?.externalUrl || undefined;

// Update lead with Apify data immediately
if (apify) {
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (apify.bio && apify.bio !== lead.bio)            patch.bio            = apify.bio;
  if (apify.followerCount && apify.followerCount > 0) patch.follower_count = apify.followerCount;
  if (apify.profileUrl)                               patch.ig_profile_url = apify.profileUrl;
  if (Object.keys(patch).length > 1) {
    await db.from("leads").update(patch).eq("id", leadId);
  }
}

// Step 3: Cross-platform + SF in parallel (both depend on externalUrl from Apify)
const [candidates, sfMatch] = await Promise.all([
  findCrossPlatformHandles({
    username:   igUsername,
    fullName:   apify?.fullName,
    externalUrl,
    apifyToken: process.env.APIFY_TOKEN,
  }),
  lookupLeadInSalesforce({
    displayName: apify?.fullName || lead.name || undefined,
    igUsername:  igUsername || undefined,
    externalUrl: externalUrl || undefined,
  }),
]);
// candidates is now real, not null
```

Remove the dead `void crossPlatformCandidates` line. Pass `candidates` (not the null variable) to `buildResearchPrompt`.

---

## FIX 6: research-lead — Fix Fire-and-Forget URL
**Problem:** `process.env.VERCEL_URL` gives the deployment subdomain (e.g., `unified-sales-ops-abc123.vercel.app`) not the custom domain. On production with a custom domain, this breaks.

**Location:** `app/api/ig-events/route.ts` — the fire-and-forget fetch at the bottom

```typescript
// Replace:
const baseUrl = process.env.VERCEL_URL
  ? `https://${process.env.VERCEL_URL}`
  : (process.env.NEXT_PUBLIC_BASE_URL ?? "http://localhost:3000");

// With:
const baseUrl = process.env.NEXT_PUBLIC_BASE_URL
  ?? (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
```

**Also set in Vercel env:** Add `NEXT_PUBLIC_BASE_URL=https://unified-sales-ops.vercel.app` (or custom domain).

**Note:** This file is in `app/api/ig-events/route.ts` which is owned by T5 — T4 should note this fix and T5 applies it.

---

## FIX 7: research-lead — Add force Flag
**Problem:** Route returns 400 when `research_status === "complete"`, blocking re-research.  
**Location:** `app/api/ai/research-lead/route.ts` — the guard check

```typescript
// Add force flag to request body:
const { leadId, force } = body as { leadId?: string; force?: boolean };

// Change the guard:
if (lead.research_status === "complete" && !force) {
  return NextResponse.json({ error: "Research already complete. Pass force: true to re-run." }, { status: 400 });
}
```

---

## FIX 8: scoring.ts — Use AI fitScore When Available
**Problem:** `scoreLead()` computes a basic heuristic score (follower count + bio keywords + external URL + GMV + stack). But AI `fitScore` in `research_cache` is much more accurate. After research completes, the heuristic score may OVERWRITE the better AI score in `leads.score`.

Actually the AI score is stored in `research_cache.fitScore` (jsonb), while the heuristic is in `leads.score` (integer). The research-lead route DOES set `score: fitScore` when writing research results. But then any PATCH call (stage change, etc.) re-runs `scoreLead()` and may write a different value.

**Fix in scoring.ts:** When `research_cache.fitScore` is present, use it:
```typescript
export function scoreLead(profile: ScoringInput): number {
  // If AI research has already scored this lead, trust it
  const cache = (profile.researchCache ?? {}) as ResearchCache;
  const aiFitScore = typeof cache.fitScore === "number" ? cache.fitScore : null;
  if (aiFitScore !== null) {
    // AI score is the source of truth — don't overwrite with heuristic
    return aiFitScore;
  }

  // Fallback: heuristic scoring for unresearched leads
  let score = 0;
  // ... rest of existing logic unchanged
}
```

---

## FIX 9: lib/claude.ts — Misleading Name + Error Handling
**Problem:** File is called `claude.ts` but uses Google Generative AI (Gemini). Confusing. Also, the `ask()` function has no timeout — a hanging Gemini call blocks the research pipeline indefinitely.

**Fix:** Add a timeout wrapper:
```typescript
export async function ask(
  systemPrompt: string,
  userMessage: string,
  maxTokens = 4096,
  timeoutMs = 45_000
): Promise<string> {
  const model = genAI.getGenerativeModel({
    model: "gemini-2.0-flash",
    systemInstruction: systemPrompt,
    generationConfig: { maxOutputTokens: maxTokens },
  });

  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error("Gemini call timed out after 45s")), timeoutMs)
  );

  try {
    const result = await Promise.race([
      model.generateContent(userMessage),
      timeout,
    ]);
    return (result as Awaited<ReturnType<typeof model.generateContent>>).response.text();
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("[claude/gemini] error:", msg);
    throw new Error(`Gemini call failed: ${msg}`);
  }
}
```

---

## VERIFICATION
```bash
# useLeads: realtime fires once, not twice per change (check network tab)
# PATCH without bio/research changes: 1 DB round trip (no SELECT)
# research-lead: candidates is NOT null after fix (add console.log temporarily)
# research-lead: POST with { leadId, force: true } succeeds on complete leads
# scoring: lead with research_cache.fitScore=85 stays at 85 after a stage PATCH
# Gemini calls timeout after 45s instead of hanging indefinitely
```

## COORDINATES WITH
- **T2**: PATCH body now includes `dm_sent_at` — the route must NOT strip unknown fields (it doesn't, it uses `...fields` spread — already safe)
- **T3**: Batch research calls with `force: true` — ensure the flag is accepted
- **T5**: `ig-events/route.ts` fire-and-forget URL fix — T5 applies it (they own that file)
- **T5**: `normalizeLead` in `useLeads.ts` — coordinate on the order of adding new fields. T4 adds `twitter_username`, `external_url`, `ig_user_id`; T5 should not duplicate these
