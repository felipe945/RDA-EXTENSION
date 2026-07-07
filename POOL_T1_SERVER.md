# POOL — Terminal 1: SERVER + DASHBOARD (per-rep personal touches)

## MISSION
Split the two-touch model: the **FanBasis touch stays team-shared and is the ONLY thing that marks a lead contacted**; **personal-IG touches become per-rep** (each rep has their own state on the same lead, stamped server-side so clients can't clobber each other). Admin sees which reps personally touched a lead. Felipe's locked decisions: "personal-first stays queued" (a personal DM never changes stage / never dequeues) + "show rep names" on the dashboard.

Strategy artifact: https://claude.ai/code/artifact/08b55e1a-c023-400c-a6b8-977e95acaec5

## FILES YOU OWN
- `app/api/leads/touch/route.ts` — NEW
- `components/TouchChips.tsx`
- `app/outreach/page.tsx`
- `lib/types.ts` (only if `outreach_channels` is typed there — additive change)

## DO NOT TOUCH
- Anything under `chrome-extension/` (T2 owns instagram.js, sidepanel.js, background.js, manifest.json)
- `lib/leads-update.ts` — its existing shallow top-level merge of `outreach_channels` is load-bearing back-compat: old extensions PATCH `{ig_personal: ...}` and the shallow merge preserves the new `ig_personal_by` key untouched. Leave it exactly as is.
- `lib/queue.ts`, `lib/stages.ts` — queue semantics don't change (stage still drives the queue; what changes is WHO sets the stage, and that's T2 + BUILD 3 here).

## DATA SHAPE (Contract TOUCH — shared with T2, no SQL migration)
```
outreach_channels: {
  ig_fanbasis:    { sent: boolean, sentAt: number, byId?: string, byName?: string },  // shared
  ig_personal_by: { [repId: string]: { sent: boolean, sentAt: number, name: string, handle?: string | null } },  // NEW per-rep
  ig_personal:    { sent: boolean, sentAt: number }   // LEGACY aggregate — derived: any rep's personal sent
}
```
The server derives `ig_personal` from `ig_personal_by` on every touch write so extensions still on ≤2.12.0 render something sane.

---

## BUILD 1 — `app/api/leads/touch/route.ts` (NEW)

`POST /api/leads/touch` — body `{ leadId: string, channel: "ig_fanbasis" | "ig_personal", sent?: boolean }` (`sent` defaults `true`; `false` un-marks).

**Auth — dual, mirroring how the extension already reaches the API:**
- Extension path: bearer repToken — resolve rep exactly the way `app/api/ig-events/route.ts` does (it derives `repId` / `rep?.team_id` from the token; reuse that same helper/import, do not roll new verification).
- Dashboard path: NextAuth session (proxy.ts already 401s unauthenticated /api — a session-authed dashboard fetch arrives with the cookie; resolve the user's id/name from the session the way other session-reading routes do).
- Resolve `{ repId, repName, personalHandle }`: for the extension path, look up name + `personal_ig_username` from the same users lookup bootstrap uses (`app/api/extension/bootstrap/route.ts:65-69` reads `user?.name`, `user?.personal_ig_username`). 401 if neither auth resolves.

**Behavior (server-side deep merge — this route, not the client, owns the shape):**
```ts
const db = supabaseServer();
const { data: lead } = await db.from("leads")
  .select("id, outreach_channels").eq("id", leadId).maybeSingle();
if (!lead) return NextResponse.json({ error: "not_found" }, { status: 404 });

const chs = (lead.outreach_channels ?? {}) as Record<string, any>;
const now = Date.now();

if (channel === "ig_fanbasis") {
  chs.ig_fanbasis = sent
    ? { sent: true, sentAt: now, byId: repId, byName: repName }
    : { sent: false };
} else {
  const by = { ...(chs.ig_personal_by ?? {}) };
  by[repId] = sent
    ? { sent: true, sentAt: now, name: repName, handle: personalHandle ?? null }
    : { sent: false, sentAt: now, name: repName, handle: personalHandle ?? null };
  chs.ig_personal_by = by;
  // Legacy aggregate for ≤2.12.0 extensions: any rep's personal touch
  const any = Object.values(by).find((e: any) => e?.sent);
  chs.ig_personal = any ? { sent: true, sentAt: (any as any).sentAt } : { sent: false };
}

await db.from("leads").update({ outreach_channels: chs, updated_at: new Date().toISOString() }).eq("id", leadId);
return NextResponse.json({ ok: true, outreach_channels: chs });
```
**NO stage writes in this route** — stage stays the send-flows' concern (and only FanBasis sends set it; T2 enforces that in the extension, BUILD 3 here for the dashboard).

**Do NOT add this route to `proxy.ts` OPEN_API_PREFIXES** — it must stay behind auth. The extension reaches it with its bearer token exactly like `/api/leads` PATCH does today (background.js:262-268 pattern).

## BUILD 2 — `components/TouchChips.tsx`: shared FanBasis chip + per-rep personal chips

Current: two anonymous chips reading `chs.ig_fanbasis` / `chs.ig_personal` (file is small — full rewrite is fine, keep it read-only).

New render rules:
- **FanBasis chip** (unchanged position): `✓ FanBasis IG · Jul 7` — append `· byName` when present (`chs.ig_fanbasis.byName`), e.g. `✓ FanBasis IG · Cam · Jul 7`. Keep the teal done / gray pending styling.
- **Personal chips**: read `chs.ig_personal_by`; render ONE chip per rep entry with `sent: true`: `✓ Cam` (title attr = handle + date), blue-tinted (`#3B82F6`-family) to visually separate from the shared teal FanBasis chip.
- Empty state: when `ig_personal_by` has no sent entries, render one gray `○ Personal IG` chip (same as today's pending look).
- Back-compat: if `ig_personal_by` is absent but legacy `chs.ig_personal?.sent` is true (old data), render a dimmed `✓ Personal (unattributed)` chip so history isn't hidden.
- Keep the LinkedIn chip behavior exactly as is.

Type the new shape locally in the component (or extend `lib/types.ts` if `outreach_channels` is typed there — additive only).

## BUILD 3 — `app/outreach/page.tsx`: queue "✓ DM Sent" records the FanBasis touch

The queue's DM-Sent flow IS the FanBasis outbound motion — it already sets stage "DM Sent" (in `markSent`'s deferred timer, ~line 114-130). After the existing stage PATCH succeeds, add a fire-and-forget touch record so the chips tell the truth:

```ts
await fetch("/api/leads/touch", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ leadId: capturedLead.id, channel: "ig_fanbasis" }),
}).catch(() => {});
```
Place it inside the same timer block (after the `/api/leads` PATCH, before/alongside the `/api/messages` POST). Undo (`undoSent`) fires before the timer, so an undone send records nothing — correct for free.

---

## VERIFICATION
1. `npm run build` — clean.
2. `curl -X POST localhost:3000/api/leads/touch` unauthenticated → 401 (proxy) — the route must NOT be publicly writable.
3. Authed (dev session): touch `ig_personal` on a test lead as yourself → row's `outreach_channels.ig_personal_by.<your-id>` = `{sent:true, name, handle}`, `ig_personal.sent` = true (derived), **stage unchanged**; the lead still appears in the outreach queue.
4. Touch `ig_fanbasis` → `ig_fanbasis` = `{sent, sentAt, byId, byName}`; stage still unchanged by the route itself.
5. Queue flow: card → "✓ DM Sent" → after the 5s undo window, lead has stage "DM Sent" AND `ig_fanbasis.byName` = you. Undo within 5s → neither written.
6. TouchChips on lead detail + queue card: shows `✓ FanBasis IG · <name>` and one blue chip per personally-touched rep; a legacy lead (only old `ig_personal`) shows the dimmed unattributed chip.

## COORDINATES WITH
- **T2 (extension)** calls your `/api/leads/touch` via a new background `TOUCH_LEAD` message and stops setting stage on personal-only sends. Contract: route path, body `{leadId, channel, sent?}`, response `{ok, outreach_channels}`. If T2 tests before you land, their calls 404 — harmless (they `.catch()`).
- Old extensions (≤2.12.0) keep PATCHing legacy `ig_personal` via `/api/leads` — `lib/leads-update.ts`'s shallow merge preserves `ig_personal_by` (why you must not touch that file).
- Your changes ship on git push, independent of the extension cycle.

When done, write `HANDOFF_POOL_T1.md`: what you built, deviations, verification results.
