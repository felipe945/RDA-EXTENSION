# CONNECT — Fix & Close-Out Plan

**Context:** the one-Google-sign-in wave (T1 dashboard + T2 extension v2.2.0) is shipped, migration `014` is applied + verified, and the token→bootstrap→calendar chain is live. This plan covers what's left to make it fully working for reps: one root-cause fix, one latent bug, the manual close-out steps, and deferred cleanup.

Status legend: 🔴 blocker · 🟠 should-fix-before-rollout · 🟢 deferred/cleanup · owner in **bold**.

---

## 1 · ✅ Root cause of the base-URL bugs — fix it once, globally  **(DONE 2026-07-02)**

> **Done:** `NEXT_PUBLIC_BASE_URL=https://unified-sales-ops.vercel.app` set in Vercel prod + preview + dev and appended to `.env.local`; production redeployed (fresh build, aliased). Live bootstrap curl with a rep token returned 200 with `dashboardUrl` = alias.

Two immutable-deploy-URL leaks were already patched per-route (`auth/start` `d722f32`, `bootstrap` `445e58f`). But the **root cause** is one thing:

`lib/base-url.ts` precedence is `NEXT_PUBLIC_BASE_URL ?? VERCEL_URL ?? NEXTAUTH_URL ?? localhost`. On Vercel `VERCEL_URL` is always the **immutable per-deployment host**, and `NEXT_PUBLIC_BASE_URL` (which would win) **is not set in Vercel** — it only exists in `.env.local.example:24`. So every `getBaseUrl()` call resolves to the fragile per-deploy host.

**Fix (one env var, fixes all call sites):**
- Set `NEXT_PUBLIC_BASE_URL=https://unified-sales-ops.vercel.app` in Vercel **production + preview + development**, and in local `.env.local`.
- Redeploy (or it applies on next deploy).
- Keep the two per-route `x-forwarded-host` patches as belt-and-suspenders (they already protect the extension surfaces regardless of env).

**Verify:** `curl` bootstrap with a rep token → `dashboardUrl` is the alias (already true via the patch); create a test invite → the emailed link uses the alias.

---

## 2 · ✅ Latent bug — invite emails point at a dead host  **(fixed by #1, 2026-07-02)**

> **Done:** `getBaseUrl()` precedence puts `NEXT_PUBLIC_BASE_URL` first, so all call sites (invite links + self-callbacks) now resolve to the alias. Belt-and-suspenders check for Felipe: create one invite from Settings and confirm the link host is `unified-sales-ops.vercel.app`.

`app/api/invites/route.ts:36` builds the new-rep link as `` `${getBaseUrl()}/login?invite=…` ``. Today that bakes the **immutable deploy URL** into the invite email — by the time a rep clicks, that host may be stale or garbage-collected, so onboarding links can break.

- Setting `NEXT_PUBLIC_BASE_URL` (#1) fixes this automatically.
- The self-callbacks at `invites/route.ts:39`, `ig-events/route.ts:130`, `lib/inngest/functions/research-lead.ts:17` (`${getBaseUrl()}/api/…`) also become alias-based — currently they happen to work (they hit the current deploy) but are fragile; #1 hardens them too.

**Verify:** POST a test invite to your own email → the link host is `unified-sales-ops.vercel.app`; open it → lands on `/login?invite=`.

---

## 3 · ✅ Google re-consent — lands the calendar grant  **(DONE 2026-07-02)**

> **Done:** Felipe re-signed in; `user_integrations` google row exists with refresh_token + `calendar.events` + `calendar.readonly` scopes. Other reps still need their own one-time re-consent when they onboard.

Zero `user_integrations` google rows exist, so calendar is dormant (`connected:false`, slots return `needsCalendar:true`). This is expected, not a bug.

- **Sign into the dashboard with Google once** — the consent screen now requests `calendar.events` + `calendar.readonly`; on success the refresh token is upserted into `user_integrations(type=google)`.
- Every other rep does the same one-time re-consent before they can book.

**Verify:** `user_integrations` has a `google` row with `is_connected=true` and a refresh_token in `config`.

---

## 4 · ✅ Last-mile live verification — after #3  **(DONE 2026-07-02)**

- [x] `bootstrap` → `calendar.connected: true`
- [x] `GET /api/calendar/slots` → real freeBusy slots, 0 rule violations (9–6 ET, no weekends, ≥1h out)
- [x] `POST /api/calendar/book` → real event created on Felipe's calendar (deleted after via Google API)
- [x] `POST /api/ig-events` with Bearer repToken → lead created with `rep_id` + `ig_user_id` stamped (throwaway deleted)

> **Bonus find:** the first ig-events run 500'd and exposed that prod DB had **never applied migrations 007–010** (missing `leads.ig_user_id` — which no migration created at all — plus `source_account`, `youtube_url`/`website_url`/`enriched_at`, `messages.sent_from_handle`, inbox indexes, `read` default). Fixed 2026-07-02: new `supabase/migrations/015_leads_ig_user_id.sql` + a 007–010 catch-up block, both applied by Felipe in the SQL editor. Extension new-lead saves had been silently broken (500) since commit `4961172` — now working.

---

## 5 · 🔴 Web Store upload of extension 2.2.0  **(Felipe)**

Git push ≠ store update. Upload the `chrome-extension/ig-lead-tracker` 2.2.0 build to the Chrome Web Store (Unlisted) so installed reps auto-update to the one-sign-in version. Do this **after** #1, #3, #4 pass, so reps don't get a build whose sign-in points anywhere fragile.

---

## 6 · 🟢 Deferred cleanup — drop the dual auth  **(later)**

The extension still sends `x-ig-secret` alongside the Bearer token during rollout (`background.js:196-201`, `instagram.js:287-291`; server fallback `ig-events/route.ts:27-28`). Once every rep is on 2.2.0 and Bearer identity is confirmed stamping `rep_id`:
- Extension stops sending `x-ig-secret`.
- Server drops the secret-only fallback (Bearer required) → every write is attributable to a rep.
- Bump extension version + re-upload.

---

## 7 · ✅ Confirm Vercel Deployment Protection  **(verified 2026-07-02)**

> **Done:** the live bootstrap curl hit `https://unified-sales-ops.vercel.app/api/extension/bootstrap` and reached the app directly (200 JSON, no protection interstitial) — the alias is open for the extension's API calls.

---

## Execution order
~~1 (env var)~~ → ~~3 (Google sign-in)~~ → ~~4 (verify)~~ → **5 (Web Store — Felipe, LAST STEP)** → then 6 as cleanup. #1–#4 + #7 all done + verified live 2026-07-02.

**Only remaining action: Felipe uploads extension 2.2.0 to the Chrome Web Store (#5).** Then #6 (drop x-ig-secret dual auth) once all reps are on 2.2.0.
