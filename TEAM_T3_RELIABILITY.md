# TEAM-T3 — Error Monitoring, Webhook Validation, Background Jobs

## Files Owned
- `.env.local.example` (create — the definitive one, list every var any terminal needs)
- `instrumentation.ts` (create)
- `sentry.server.config.ts`, `sentry.edge.config.ts` (create)
- `app/global-error.tsx` (create)
- `app/api/ig-events/route.ts` (modify — add zod validation only, don't touch business logic)
- `app/api/sendblue/route.ts`, `app/api/sendblue/webhook/route.ts` (modify — add zod validation only)
- `lib/inngest.ts` (create)
- `app/api/inngest/route.ts` (create)
- `lib/inngest/functions/nightly-scoring.ts` (create)
- `lib/inngest/functions/daily-briefing.ts` (create)
- `lib/inngest/functions/research-lead.ts` (create — wraps the existing research call with retry)
- `package.json` (modify — add `zod`, `inngest`, `@sentry/nextjs`)

## Do NOT touch
- `lib/auth.ts`, `middleware.ts`, anything under `app/api/invites`, `app/api/team`, `app/api/leads/assign-next` — owned by TEAM-T1
- `components/`, `app/settings/`, `app/login/` — owned by TEAM-T2
- Don't change the business logic inside `app/api/ig-events/route.ts` or the sendblue routes — only wrap the existing body-parsing with validation

---

## Context

This is the reliability work, independent of the team feature — it fixes three things confirmed broken or missing in the audit:

1. `vercel.json` has zero `crons` entries — the nightly lead scoring and daily briefing that were planned never actually run.
2. Webhook routes (`ig-events`, `sendblue`) trust raw `req.json()` with no schema validation.
3. Failures are silent everywhere — `console.error` only, no monitoring, and a transient Claude API failure in the research pipeline just drops that lead's research forever with no retry.

Fix: Sentry for visibility, zod for input validation, and Inngest for durable scheduled/retryable jobs (chosen over a Vercel Cron + raw fetch approach because Inngest steps survive function timeouts and retry automatically — a raw fetch from `vercel.json` cron does neither, and BullMQ needs a persistent worker process Vercel doesn't provide).

---

## BUILD 1: Install dependencies

```bash
npm install zod inngest @sentry/nextjs
```

---

## BUILD 2: `.env.local.example`

Write every var actually referenced via `process.env.*` across the codebase (grep `app/`, `lib/` for `process.env` to get the full list), plus the new ones this terminal introduces. At minimum:

```bash
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=

# Auth
NEXTAUTH_SECRET=
NEXTAUTH_URL=http://localhost:3000
GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=

# AI
ANTHROPIC_API_KEY=

# Instagram / lead capture
IG_EVENTS_SECRET=

# SMS
SENDBLUE_API_KEY=
SENDBLUE_API_SECRET=
SENDBLUE_WEBHOOK_SECRET=

# LinkedIn enrichment (optional)
APIFY_TOKEN=

# Error monitoring (new)
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=

# Background jobs (new)
INNGEST_EVENT_KEY=
INNGEST_SIGNING_KEY=

# Notification delivery (new — plain Slack Incoming Webhook, not the Slack MCP,
# since Inngest functions run server-side outside any Claude Code session)
SLACK_NOTIFICATIONS_WEBHOOK_URL=
```

Cross-check this list against actual `process.env.` usage before finalizing — if TEAM-T1 or TEAM-T2 add a var you didn't anticipate, pick it up from their `HANDOFF_TEAM_T*.md` files during integration.

---

## BUILD 3: Sentry setup

`instrumentation.ts` (repo root):

```typescript
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

export async function onRequestError(err: unknown, request: { path: string; method: string }) {
  const Sentry = await import("@sentry/nextjs");
  Sentry.captureException(err, { extra: { path: request.path, method: request.method } });
}
```

`sentry.server.config.ts`:

```typescript
import * as Sentry from "@sentry/nextjs";

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  tracesSampleRate: 0.1,
  enabled: process.env.NODE_ENV === "production",
});
```

`sentry.edge.config.ts` — identical content, separate file (Next.js convention, don't try to share one file across runtimes).

`app/global-error.tsx`:

```tsx
"use client";
import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

export default function GlobalError({ error }: { error: Error & { digest?: string } }) {
  useEffect(() => { Sentry.captureException(error); }, [error]);
  return (
    <html>
      <body className="flex min-h-screen items-center justify-center bg-[#070B12] text-[#E2E8F0]">
        <div className="text-center">
          <p className="mb-2 text-lg">Something broke.</p>
          <p className="text-sm text-[#94A3B8]">It's been logged — try refreshing.</p>
        </div>
      </body>
    </html>
  );
}
```

Update `next.config.ts` to wrap the config with `withSentryConfig` per the current `@sentry/nextjs` docs (run `npx @sentry/wizard@latest -i nextjs` if the manual config drifts from what that version of the SDK expects — check `node_modules/@sentry/nextjs` version installed before hand-writing this, the manual API changes between major versions).

---

## BUILD 4: Zod validation on webhook routes

`app/api/ig-events/route.ts` — add near the top, without touching the handler logic below it:

```typescript
import { z } from "zod";

const igEventSchema = z.object({
  type: z.string(),
  username: z.string(),
  userId: z.string().optional(),
  pageUrl: z.string().optional(),
  bio: z.string().optional(),
  followerCount: z.number().optional(),
  profileUrl: z.string().optional(),
  displayName: z.string().optional(),
});

// inside POST, replace the existing `body = await req.json()` + manual destructure with:
const rawBody = await req.json();
const parsed = igEventSchema.safeParse(rawBody);
if (!parsed.success) {
  return Response.json({ error: "Invalid payload", details: parsed.error.flatten() }, { status: 400 });
}
const { type, username, userId, pageUrl, bio, followerCount, profileUrl, displayName } = parsed.data;
```

Apply the same pattern to `app/api/sendblue/route.ts` and `app/api/sendblue/webhook/route.ts` — read the existing body shape each route expects (check what fields it currently destructures) and write a matching zod schema, returning 400 on failure instead of letting a malformed payload crash into a 500 further down.

---

## BUILD 5: `lib/inngest.ts`

```typescript
import { Inngest } from "inngest";

export const inngest = new Inngest({ id: "unified-sales-ops" });
```

`app/api/inngest/route.ts`:

```typescript
import { serve } from "inngest/next";
import { inngest } from "@/lib/inngest";
import { nightlyScoring } from "@/lib/inngest/functions/nightly-scoring";
import { dailyBriefing } from "@/lib/inngest/functions/daily-briefing";
import { researchLead } from "@/lib/inngest/functions/research-lead";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [nightlyScoring, dailyBriefing, researchLead],
});
```

---

## BUILD 6: `lib/inngest/functions/nightly-scoring.ts`

```typescript
import { inngest } from "@/lib/inngest";
import { supabaseServer } from "@/lib/supabase";
import { scoreLead } from "@/lib/scoring";

export const nightlyScoring = inngest.createFunction(
  { id: "nightly-lead-scoring", retries: 2 },
  { cron: "0 6 * * *" }, // 6am daily
  async ({ step }) => {
    const db = supabaseServer();

    const leads = await step.run("fetch-active-leads", async () => {
      const { data } = await db
        .from("leads")
        .select("id, bio, follower_count, ig_profile_url")
        .not("stage", "in", "(Closed,DQ)");
      return data ?? [];
    });

    await step.run("rescore", async () => {
      for (const lead of leads) {
        const score = scoreLead({
          bio: lead.bio ?? undefined,
          followerCount: lead.follower_count ?? undefined,
          externalUrl: lead.ig_profile_url ?? undefined,
        });
        await db.from("leads").update({ score }).eq("id", lead.id);
      }
    });

    return { rescored: leads.length };
  }
);
```

---

## BUILD 7: `lib/inngest/functions/daily-briefing.ts`

Reuse the scoring logic already in `app/api/ai/summary/route.ts` — call that route's underlying function directly if it's exported separately, or replicate its query + Claude summarization call here. Deliver via the plain Slack webhook (not the MCP — this runs outside any Claude Code session):

```typescript
import { inngest } from "@/lib/inngest";
import { supabaseServer } from "@/lib/supabase";

export const dailyBriefing = inngest.createFunction(
  { id: "daily-briefing", retries: 2 },
  { cron: "0 13 * * 1-5" }, // 8am ET weekdays
  async ({ step }) => {
    const db = supabaseServer();

    const overdue = await step.run("fetch-overdue", async () => {
      const { data } = await db
        .from("leads")
        .select("id, name, ig_username, due_at, stage")
        .lt("due_at", new Date().toISOString())
        .not("stage", "in", "(Closed,DQ)");
      return data ?? [];
    });

    await step.run("send-slack", async () => {
      if (!process.env.SLACK_NOTIFICATIONS_WEBHOOK_URL) return;
      const lines = overdue.map((l) => `• ${l.name ?? l.ig_username} — ${l.stage}, due ${l.due_at}`);
      await fetch(process.env.SLACK_NOTIFICATIONS_WEBHOOK_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: overdue.length
            ? `*Morning briefing — ${overdue.length} overdue*\n${lines.join("\n")}`
            : "Morning briefing — nothing overdue today.",
        }),
      });
    });

    return { overdueCount: overdue.length };
  }
);
```

This also directly plugs the "notifications table has nothing consuming it" gap — extend `overdue` to also insert into the `notifications` table if the dashboard should show a persistent banner, not just the Slack message.

---

## BUILD 8: `lib/inngest/functions/research-lead.ts` — retry wrapper for the Claude pipeline

The existing `app/api/ai/research-lead/route.ts` is called fire-and-forget from `app/api/ig-events/route.ts` with no retry — a transient Anthropic API error silently drops that lead's research. Move the actual research call behind an Inngest event so it gets automatic retries:

```typescript
import { inngest } from "@/lib/inngest";
import { supabaseServer } from "@/lib/supabase";

export const researchLead = inngest.createFunction(
  { id: "research-lead", retries: 3 },
  { event: "lead/research.requested" },
  async ({ event, step }) => {
    const { leadId } = event.data as { leadId: string };
    const db = supabaseServer();

    const result = await step.run("call-research-route", async () => {
      const res = await fetch(`${process.env.NEXTAUTH_URL}/api/ai/research-lead`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId }),
      });
      if (!res.ok) throw new Error(`research-lead failed: ${res.status}`);
      return res.json();
    });

    return result;
  }
);
```

In `app/api/ig-events/route.ts`, replace the existing fire-and-forget `fetch("/api/ai/research-lead", ...)` call with:

```typescript
import { inngest } from "@/lib/inngest";
// ...
await inngest.send({ name: "lead/research.requested", data: { leadId } });
```

This is the one line TEAM-T3 changes inside `ig-events/route.ts` beyond the zod validation in BUILD 4 — keep it minimal, don't touch anything else in that handler.

---

## VERIFICATION
```
1. npm run build — no type errors after adding zod/inngest/@sentry/nextjs
2. npx inngest-cli@latest dev — discovers all 3 functions at http://localhost:3000/api/inngest
3. Manually trigger nightly-scoring from the Inngest dev UI → leads get re-scored
4. Manually trigger daily-briefing → Slack webhook receives a message (use a real webhook URL from a test Slack app)
5. POST malformed JSON to /api/ig-events (missing "username") → 400 with a validation error, not a 500
6. Temporarily throw inside the research-lead route → Inngest retries 3x with backoff, visible in the dev UI
7. Throw an uncaught error anywhere in a Server Component → Sentry captures it (check the Sentry dashboard, or console output if DSN is unset)
8. .env.local.example has every var the app actually reads — cross-check with `grep -rn "process.env\." app lib`
```

## COORDINATES WITH
- **TEAM-T1**: No shared files. If their invite-email send (via `/api/gmail/send`) should also get zod validation, that's a fast follow, not blocking this round.
- **TEAM-T2**: None — this terminal touches no UI.
- Before deploying: register the app at app.inngest.com (or self-host the dev server) to get real `INNGEST_EVENT_KEY`/`INNGEST_SIGNING_KEY` values, and remove the now-redundant empty `crons` scaffolding from `vercel.json` if any is added elsewhere — Inngest owns scheduling now, not Vercel Cron.
