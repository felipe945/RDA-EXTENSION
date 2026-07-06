# PARALLEL — Terminal 1 (Server/Data/Pipeline) — Summary & Checkpoints

> T2 polls `CHECKPOINT_S` before wiring stage imports. T3 polls `CHECKPOINT_S`
> before the esbuild pack step. T2 integration-tests against `CHECKPOINT_SCOPE`.

## Checkpoints

- **`CHECKPOINT_S: done @ f212f41`** — `lib/stages.ts` + `lib/queue.ts` landed,
  self-contained, browser-pure, exports match the contracts, `npx tsc --noEmit`
  clean. Safe for T2 (stage imports) and T3 (esbuild bundle) to integrate.

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
- [ ] Phase 2 — scope model + pagination → CHECKPOINT SCOPE
- [ ] Phase 3 — import consistency
- [ ] Phase 4 — guarantee the opener (flagship; cost-gated drain)
- [ ] Phase 5 — delete dead SMS/Sendblue routes
- [ ] Phase 6 — CSM stage migration (guarded; may land UNAPPLIED)
- [ ] Phase 7 — live verify + final summary
