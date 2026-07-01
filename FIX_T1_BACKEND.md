# FIX-T1 — Backend Reliability: Research-Trigger Guard + Base-URL Consistency

## Files Owned
- `app/api/ig-events/route.ts` (modify — the research-trigger guard, BUILD 1)
- `lib/base-url.ts` (create — BUILD 2)
- `lib/inngest/functions/research-lead.ts` (modify — use the shared helper, BUILD 2)
- `app/api/invites/route.ts` (modify — use the shared helper, BUILD 2)

## Do NOT touch
- `lib/types.ts`, `hooks/useLeads.ts`, `components/Dashboard.tsx`, `components/LeadDetailPanel.tsx` — owned by FIX-T2
- Any business logic inside `ig-events` beyond the single `inngest.send` line — the IG_PROFILE_SAVE / IG_FOLLOW / IG_LIKE handling stays exactly as-is

## Not in scope — leave alone
- The `notifications` "producer" gap from the earlier audit is **void**: there is no `notifications` table. `app/api/notifications/route.ts` computes the feed on the fly from `messages` + `leads`, and `daily-briefing.ts` already queries overdue leads directly for its Slack push. Do not create a table or add a producer.

---

## Context

The post-audit build passes, but one runtime regression is hiding behind it. In `app/api/ig-events/route.ts`, the `IG_PROFILE_SAVE` handler used to fire-and-forget a `fetch("/api/ai/research-lead")` — if research failed, the save still succeeded silently. TEAM-T3 replaced that with:

```ts
await inngest.send({ name: "lead/research.requested", data: { leadId } });
return Response.json({ ok: true, leadId });
```

This `await` is **unguarded and runs before the success response**. If Inngest isn't reachable — which is the current state, since the Inngest keys aren't set yet — the whole handler throws. The Chrome extension's Save button then errors even though the lead was already written to the DB, and research never triggers. This is the app's #1 feature.

Your job: make the research trigger non-fatal to the save, with a fallback so research still works before Inngest is provisioned. Plus a small base-URL consistency cleanup while you're in the backend.

---

## BUILD 1: Guard the research trigger in `app/api/ig-events/route.ts`

The current code (around line 106-110):

```ts
    // Durable research trigger — Inngest retries transient Anthropic failures
    // with backoff instead of the old fire-and-forget fetch that dropped them.
    await inngest.send({ name: "lead/research.requested", data: { leadId } });

    return Response.json({ ok: true, leadId });
```

Replace with a guarded send that falls back to the old direct fetch, and never blocks the save:

```ts
    // Durable research trigger. Inngest retries transient Anthropic failures with
    // backoff. But the save itself must NEVER fail because research couldn't be
    // enqueued — a saved-but-unresearched lead is fine (research_status stays
    // 'pending' and can be retried), a failed save loses the lead entirely.
    try {
      await inngest.send({ name: "lead/research.requested", data: { leadId } });
    } catch (err) {
      // Inngest unreachable (keys unset / dev server down). Fall back to the old
      // fire-and-forget direct call so research still runs pre-Inngest, and log
      // for Sentry instead of throwing into the save response.
      console.error("inngest.send failed, falling back to direct research fetch", err);
      const { getBaseUrl } = await import("@/lib/base-url");
      fetch(`${getBaseUrl()}/api/ai/research-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      }).catch((e) => console.error("fallback research fetch failed", e));
    }

    return Response.json({ ok: true, leadId });
```

Note: the fallback `fetch` is intentionally **not** awaited — it's fire-and-forget like the original, so a slow/failed research call never delays or breaks the save response. The lead is already persisted with `research_status: "pending"` above; worst case it stays pending and gets picked up on a later save or a manual re-research.

---

## BUILD 2: Base-URL helper — one source of truth

Three backend spots resolve the app's base URL three different ways today:
- `lib/inngest/functions/research-lead.ts` — `NEXT_PUBLIC_BASE_URL ?? VERCEL_URL ?? localhost`
- `app/api/invites/route.ts` — `process.env.NEXTAUTH_URL` (breaks the invite link if unset)
- `app/api/ig-events/route.ts` — the new fallback added in BUILD 1

Create `lib/base-url.ts`:

```ts
// Single source of truth for the app's own origin, used by server-side code that
// needs to call back into its own routes (research trigger, invite links, etc.).
// Order: explicit override → Vercel-injected host → NextAuth URL → local dev.
export function getBaseUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BASE_URL ??
    (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : undefined) ??
    process.env.NEXTAUTH_URL ??
    "http://localhost:3000"
  );
}
```

Then:

**`lib/inngest/functions/research-lead.ts`** — replace the inline `baseUrl` expression (currently lines ~18-20) with:

```ts
import { getBaseUrl } from "@/lib/base-url";
// ...
const baseUrl = getBaseUrl();
const res = await fetch(`${baseUrl}/api/ai/research-lead`, {
```

**`app/api/invites/route.ts`** — replace `const inviteUrl = \`${process.env.NEXTAUTH_URL}/login?invite=${invite!.token}\`;` with:

```ts
import { getBaseUrl } from "@/lib/base-url";
// ...
const inviteUrl = `${getBaseUrl()}/login?invite=${invite!.token}`;
```

Also switch the `fetch(\`${process.env.NEXTAUTH_URL}/api/gmail/send\`, ...)` in the same file to `fetch(\`${getBaseUrl()}/api/gmail/send\`, ...)`. Keep the cookie-forwarding header and try/catch exactly as they are.

---

## VERIFICATION
```
1. npm run build — clean
2. With NO Inngest configured (no INNGEST_EVENT_KEY, no dev server):
   POST a valid IG_PROFILE_SAVE to /api/ig-events → still returns 200 {ok,leadId},
   lead is created, console logs the fallback path (does NOT 500)
3. With `npx inngest-cli@latest dev` running:
   same POST → 200, and the research-lead function fires in the Inngest dev UI
4. Unset NEXTAUTH_URL locally, POST /api/invites → inviteUrl is
   http://localhost:3000/login?invite=... (not undefined/login?invite=...)
5. grep -rn "process.env.NEXTAUTH_URL" app/api/invites → no direct uses remain for URL building
```

## COORDINATES WITH
- **FIX-T2**: No shared files. FIX-T2 only touches the Lead type + two components; this terminal only touches API routes + one new lib file.
- **MANUAL (Felipe, not a terminal task)**: This fix makes saves survive an unconfigured Inngest, but scheduled scoring, the daily briefing, and automatic research retries still require the real `INNGEST_EVENT_KEY` / `INNGEST_SIGNING_KEY` (+ `SENTRY_DSN`, `SLACK_NOTIFICATIONS_WEBHOOK_URL`) to be set. And before any sign-in works at all, `supabase/migrations/011_teams.sql` then `scripts/seed-team.sql` must be run in the Supabase SQL editor.
