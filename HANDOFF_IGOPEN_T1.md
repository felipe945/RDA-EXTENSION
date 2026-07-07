# HANDOFF — FIX_IGOPEN T1 (Dashboard)

## Status: COMPLETE — build clean, server behavior verified live

## What changed (4 owned files, exactly per plan)

1. **`components/ig.tsx`** — `igDmUrl` DELETED (it built `instagram.com/direct/t/<username>`, which only accepts numeric thread ids → dumped reps on the Messages inbox). Added `igOpenUrl(lead)`: username-first (canonical `https://www.instagram.com/<handle>/` from `ig_username`), falls back to stored `ig_profile_url` only for username-less leads. `igProfileUrl` + `IgHandle` untouched.

2. **`app/outreach/page.tsx`** — `primaryAction()` IG branch now uses `igOpenUrl(lead)`; stale "opens the DM thread" comment replaced with the accurate one. Import updated (`igDmUrl`/`igProfileUrl` out, `igOpenUrl` in — `igProfileUrl` had no other use in this file). Button label: "Copy opener **+ Open profile**".

3. **`app/leads/[id]/page.tsx`** — "IG →" header link now `igOpenUrl(lead)`-based: username-first, and no longer vanishes for leads with a username but null `ig_profile_url`.

4. **`app/api/ig-events/route.ts`** — `IG_PROFILE_SAVE` handler derives `canonicalIgUrl` server-side from the handle (never trusts the client's page URL). Update branch uses `?? undefined` so a username-less payload leaves the existing value alone; insert branch stores the canonical URL. **This also fixes the re-save-nulls-good-URL bug** (extension sends no `profileUrl`, so every re-save of a researched lead used to overwrite its Apify URL with null). `saveEvent.postUrl` untouched (raw page URL kept in event history on purpose).

## Verification results

- `npm run build` → clean, zero type errors (Next 16.2.9).
- `grep -rn "igDmUrl\|/direct/t/" app components lib hooks` → **one hit: the explanatory comment** in outreach/page.tsx that the plan's own BUILD 2 snippet specifies (documents why /direct/t/ can't work). Zero live code references. `instagram.com/direct` → zero hits.
- **Live API test** (local dev server → prod Supabase, throwaway lead `fbtest_igopen_t1_verify`, deleted after):
  - Fresh save with a garbage client `profileUrl` (`…/direct/t/garbage?hl=en`) → stored `ig_profile_url` = `https://www.instagram.com/fbtest_igopen_t1_verify/` ✅
  - Re-save with NO `profileUrl` (real extension behavior) → URL kept canonical, not nulled ✅

## Deviations
- None functional. The plan's "zero grep hits for /direct/t/" verification conflicts with the plan's own mandated comment text; kept the comment, since it's documentation not code.
- Visual click-through of /outreach + lead detail (auth-walled pages) not done in this terminal — logic is type-checked and the URL builder is the same `igProfileUrl` already proven by the `@handle` links. Worth a 30-second eyeball after deploy.

## Ships on git push (Vercel auto-deploy) — independent of T2/T3's extension Web Store cycle.
