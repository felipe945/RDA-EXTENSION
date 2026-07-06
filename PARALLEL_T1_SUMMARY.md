# PARALLEL — Terminal 1 (Server/Data/Pipeline) — Summary & Checkpoints

> T2 polls `CHECKPOINT_S` before wiring stage imports. T3 polls `CHECKPOINT_S`
> before the esbuild pack step. T2 integration-tests against `CHECKPOINT_SCOPE`.

## Checkpoints

- **`CHECKPOINT_S: done @ f212f41`** — `lib/stages.ts` + `lib/queue.ts` landed,
  self-contained, browser-pure, exports match the contracts, `npx tsc --noEmit`
  clean. Safe for T2 (stage imports) and T3 (esbuild bundle) to integrate.

- **`CHECKPOINT_SCOPE: done @ f2371ad`** — `/api/leads?scope=mine|team` +
  pagination live. `scopeLeadsQueryFor(query, actor, scope)` in `lib/scope.ts`;
  `scopeLeadsQuery` unchanged (delegates `scope="team"`). GET paginates via a
  `.range()` full-size-page loop (PAGE_SIZE 1000) until a short page — response
  is complete, never truncates. **Verified live (`mode=sales`): old single fetch
  returned 1000, new pagination returns all 1063 rows, 0 dupes.** Ordered
  `created_at desc, id asc` (stable across pages; cold pool has null `due_at`,
  which we deliberately do NOT backfill). T2 can integration-test the toggle.

## Contract deviations (read if integrating)

- **Stage sets typed `readonly string[]`, not `Stage[]`.** `DONE_STAGES`,
  `CONTACTED_STAGES`, `DEAD_STAGES`, `TERMINAL_STAGES` intentionally retain
  legacy CSM values ("Active"/"Churned") for runtime tolerance, which `Stage`
  (sales-only) can't hold. Membership is unchanged from before **except**
  "Blocked" removed (0 leads live). Behavior is byte-identical to the prior
  queue math; only the type annotation differs. All contract functions
  (`stageColor`, `stageBucket`, `isKnownStage`, `sortScore`, `hasChannel`,
  `buildQueue`, `computeBatchProgress`) are present with the promised shapes.
- **`buildQueue` is generic** (`<T extends QueueLead>`) so dashboard callers get
  their concrete `LeadPlus[]` back. `QueueLead` is a minimal structural type
  defined locally in `lib/queue.ts` (no `@/components/ig` import). Both call
  shapes work with zero changes: `buildQueue(leads, "ig")` and
  `buildQueue(leads, { channel, snoozed, now })`.
- **`lib/stages.ts` adds `stageSqlList(stages)`** (Postgres `IN(...)` quoting
  helper) beyond the listed exports — used by `lib/assignment.ts` and the
  notifications route to avoid hand-written SQL fragments.
- **Notifications route** keeps its bespoke overdue-exclusion set
  (`NOTIFY_EXCLUDED_STAGES`) rather than forcing it into a shared set — it's a
  unique membership and folding it in would change CSM-mode notification
  behavior. It now quotes via `stageSqlList` (behavior identical).

## Status

- [x] Phase 1 — shared modules → **CHECKPOINT S** (f212f41)
- [x] Phase 2 — scope model + pagination → **CHECKPOINT SCOPE** (f2371ad)
- [x] Phase 3 — import consistency (2c8a1b0)
- [x] Phase 4 — opener pipeline built (2c8a1b0); **drain execution COST-GATED — awaiting Felipe**
- [x] Phase 5 — deleted dead SMS/Sendblue routes (2c8a1b0)
- [x] Phase 6 — CSM migration 019 written, **UNAPPLIED** (awaiting Felipe's confirm)
- [x] Phase 7 — live verify done; summary below

---

## Phase 3 — import consistency
- `bulk-import`: now pooled by default (`owner_id: null`); new `assignToMe:boolean` body flag
  claims for the importer. Research enqueue only when Inngest is configured; otherwise leads
  stay `pending` and the drain picks them up (no direct-fetch blast — honors the existing
  anti-blast guardrail).
- `import-following.ts`: already pooled (`owner_id` absent); still inserts `pending`. Added
  opt-in `--research` (throttled direct enqueue, concurrency 3, `--url` to target a deployed
  app). Default path relies on the drain cron — no surprise Claude spend on a scrape.

## Phase 4 — guarantee the opener (FLAGSHIP)
- **`app/api/opener/route.ts` now PERSISTS.** On a known `lead_id` it merge-patches the
  generated text into `research_cache.openers.{ig|personal}` + `suggestedOpener` without
  clobbering the cache. Generations stop being throwaway; this also flips the drain's
  null-opener gate for that lead.
- **`lib/research-trigger.ts` (new)** — `enqueueResearch()` prefers Inngest, falls back to a
  direct fetch when Inngest is **unconfigured** (root-cause bug: `inngest.send()` silently
  no-ops with no keys, so the old try/catch fallback never fired). `ig-events` now uses it.
- **`app/api/ai/research-drain/route.ts` (new)** — cron + admin. Finds sales IG leads with a
  null `suggestedOpener` (`research_status IN pending/none/error/enriched/enriched_v2`),
  runs `research-lead` throttled (concurrency 3). `?dryRun=1` counts; `?limit` caps a tick.
  CRON_SECRET or admin/owner auth. `vercel.json` cron every 10m at `limit=15`, maxDuration 300.

  **COST GATE — verified live 2026-07-06:** **1057 eligible** leads (431 pending, 616 enriched,
  10 enriched_v2), higher than the plan's ~836 (the 616 "enriched" got partial enrichment but
  never an opener). Per-lead Claude cost (`claude-sonnet-4-6`, ~2060 input / ≤1500 output tokens)
  ≈ **$0.027**. Full backlog ≈ **$28 Claude**, plus per-lead Apify (`fetchIgProfile` +
  cross-platform) + Salesforce lookups if those keys are set in prod (rough +$10–50). 20-lead
  test batch ≈ **$0.55 Claude**. **NOT RUN** — needs Felipe's green-light (and the app deployed
  with ANTHROPIC/APIFY keys; can't run locally, no ANTHROPIC_API_KEY here).

## Phase 5 — dead server weight
- Deleted `app/api/sms/send/route.ts`, `app/api/sendblue/route.ts`, empty `webhook/` dir.
- `.env.local.example` is **gitignored** in this repo, so the SENDBLUE removal + CRON_SECRET
  addition are local-only; the real vars must be set in Vercel regardless. `SENDBLUE_*` can be
  removed from the Vercel project; **`CRON_SECRET` must be added there** for the drain cron.

## Phase 6 — CSM stage cleanup (guarded, UNAPPLIED)
- `supabase/migrations/019_retire_csm_stages.sql` maps the 4 stray `mode=sales` `stage='Active'`
  leads → `Booked`. Verified live: Active=4, At Risk=0, Churned=0, Blocked=0. Transaction-wrapped,
  aborts if count > 50, logs the count. **Left UNAPPLIED** pending Felipe's confirm; `lib/stages.ts`
  renders legacy `Active` gray meanwhile so nothing breaks.

## Phase 7 — live verification
- `GET /api/leads` pagination: old single fetch = **1000**, new range-loop = **all 1063**, 0 dupes.
- Scope (live, admin/owner actor): `scope=team` = **1063**, `scope=mine` = **1062** (1061 pooled
  + 1 owned), no dupes across pages. No-scope param = today's behavior (delegates team).
- `grep -rn Blocked app lib` → comments only, no functional refs.
- `npx tsc --noEmit` clean; `npm run build` clean; `/api/ai/research-drain` registered; no
  sms/sendblue routes remain.

## What needs Felipe (nothing blocks T2/T3)
1. **Drain cost gate** — approve the 20-lead batch → full drain, or hold. (See Phase 4.)
2. **Migration 019** — confirm apply (maps 4 Active→Booked), or leave unapplied.
3. **Vercel env** — add `CRON_SECRET`; optionally remove `SENDBLUE_*`.
