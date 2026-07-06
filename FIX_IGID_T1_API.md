# FIX_IGID — Terminal 1 · Self-serve personal-IG API

**Feature F5 — per-user Instagram identity.** Root cause of the "everyone's Personal IG is
felipeguimars" bug: `users.personal_ig_username` is `null` for every user, there's no UI to set
it, and the extension falls back to a hardcoded `"felipeguimars"`. The DB column already exists and
`/api/extension/bootstrap` already returns it per rep (`bootstrap/route.ts:69`). The only missing
backend piece is a route each user can call to set **their own** handle.

**Do first — T2 (settings UI) depends on this route's contract.**

---

## Files you OWN
- `app/api/extension/me/route.ts` (**NEW**)

Do not touch anything else. (No migration needed — the column exists.)

---

## Exact fix — create `app/api/extension/me/route.ts`
```ts
import { type NextRequest } from "next/server";
import { supabaseServer } from "@/lib/supabase";
import { getActor } from "@/lib/scope";
import { getSupabaseErrorMessage } from "@/lib/supabaseError";

// GET  /api/extension/me  → { ok, personalIgUsername }
// PATCH/api/extension/me  { personalIgUsername }  → sets the CALLER's own handle only.
// Auth: getActor = NextAuth session (dashboard) OR Bearer repToken (extension). Under
// /api/extension, which is already on proxy.ts's open allowlist, so it self-authenticates here.

// Instagram handles: letters, numbers, period, underscore, 1–30 chars. Empty = unset.
function normalizeHandle(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const h = raw.trim().replace(/^@/, "").toLowerCase();
  if (h === "") return "";                       // explicit unset is allowed
  return /^[a-z0-9._]{1,30}$/.test(h) ? h : null; // null = invalid → 400
}

export async function GET(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const db = supabaseServer();
  const { data, error } = await db
    .from("users")
    .select("personal_ig_username")
    .eq("id", actor.userId)
    .maybeSingle();
  if (error) return Response.json({ ok: false, error: getSupabaseErrorMessage(error) }, { status: 500 });

  return Response.json({ ok: true, personalIgUsername: data?.personal_ig_username ?? null });
}

export async function PATCH(req: NextRequest) {
  const actor = await getActor(req);
  if (!actor) return Response.json({ ok: false, error: "unauthorized" }, { status: 401 });

  const body = await req.json().catch(() => ({}));
  const handle = normalizeHandle(body?.personalIgUsername);
  if (handle === null) {
    return Response.json(
      { ok: false, error: "Use only letters, numbers, periods, and underscores (max 30)." },
      { status: 400 },
    );
  }

  const db = supabaseServer();
  // Self-scoped write: only ever the caller's own row. No user id is read from the body.
  const { error } = await db
    .from("users")
    .update({ personal_ig_username: handle === "" ? null : handle })
    .eq("id", actor.userId);
  if (error) return Response.json({ ok: false, error: getSupabaseErrorMessage(error) }, { status: 500 });

  return Response.json({ ok: true, personalIgUsername: handle === "" ? null : handle });
}
```

> Confirm `getActor` exposes `userId` (it does — see `lib/scope.ts` Actor type). If the field is
> named differently in your build, use that name — the rule is **write only `actor`'s own row**.

---

## Verification
1. `npx tsc --noEmit` clean.
2. Authed GET returns the current value:
   `curl -s -H "cookie: next-auth.session-token=<owner>" localhost:3000/api/extension/me` → `{ok:true,personalIgUsername:null}`.
3. PATCH sets it: `... -X PATCH -d '{"personalIgUsername":"@Christina.X"}'` → `{ok:true,personalIgUsername:"christina.x"}` (normalized).
4. Invalid handle → **400**: `-d '{"personalIgUsername":"bad handle!"}'`.
5. Unauth → **401**: same PATCH with no cookie/token.
6. A second user's PATCH only changes their own row (query `users` — the other rows untouched).

## Contract to publish (T2 + T4 consume it)
`CHECKPOINT_IGID_API: <sha>` —
`GET /api/extension/me → {ok,personalIgUsername}` ·
`PATCH /api/extension/me {personalIgUsername} → {ok,personalIgUsername}` (200 / 400 invalid / 401 unauth).
