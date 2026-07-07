# FIX_IGOPEN — Terminal 1: DASHBOARD (kill the Messages misdirect)

## MISSION
Every "open their Instagram" click on the dashboard must land on the prospect's **profile page** — never the Messages inbox. Root cause (confirmed by audit 2026-07-07): `igDmUrl()` builds `instagram.com/direct/t/<username>`, but `/direct/t/` only accepts a numeric thread ID, so Instagram dumps the rep on the generic Messages inbox. The outreach queue's primary pink button uses it on every card.

Audit artifact: https://claude.ai/code/artifact/228f776a-4338-49da-b3f4-1826a16b9017

## FILES YOU OWN (nobody else touches these)
- `components/ig.tsx`
- `app/outreach/page.tsx`
- `app/leads/[id]/page.tsx`
- `app/api/ig-events/route.ts`

## DO NOT TOUCH
- Anything under `chrome-extension/` (T2 owns `instagram.js`, T3 owns `sidepanel.js`/`styles.css`/`manifest.json`)
- `components/LeadDetailPanel.tsx` (its Quick Reach IG link already builds from username — correct, leave it)
- `lib/queue.ts`, `hooks/useLeads.ts`, any API route not listed above

## CONTRACT (shared with T2/T3, each in their own runtime)
Canonical profile URL = `https://www.instagram.com/<handle>/` — handle lowercase-agnostic, leading `@` stripped, trailing slash, no query string. Username-first everywhere: build from `ig_username` when present; stored `ig_profile_url` is only a fallback for username-less leads.

---

## BUILD 1 — `components/ig.tsx`: delete `igDmUrl`, add `igOpenUrl`

Current (lines 16–22):

```ts
export function igProfileUrl(handle: string): string {
  return `https://www.instagram.com/${handle.replace(/^@/, "")}/`;
}

export function igDmUrl(handle: string): string {
  return `https://www.instagram.com/direct/t/${handle.replace(/^@/, "")}`;
}
```

- **DELETE `igDmUrl` entirely.** It has exactly one caller (`app/outreach/page.tsx:8,90`) which you also own. Grep to confirm zero references remain: `grep -rn igDmUrl app components lib hooks`.
- **ADD** a username-first opener used by both surfaces:

```ts
// Username-first: the stored ig_profile_url is extension/Apify-captured and
// unvalidated — only trust it when we have no handle to build from.
export function igOpenUrl(lead: { ig_username?: string | null; ig_profile_url?: string | null }): string | null {
  if (lead.ig_username) return igProfileUrl(lead.ig_username);
  return lead.ig_profile_url ?? null;
}
```

Keep `igProfileUrl` and `IgHandle` exactly as they are (both verified correct).

## BUILD 2 — `app/outreach/page.tsx`: primary button opens the PROFILE

Current `primaryAction()` (lines 82–100) — the bug:

```ts
// THE primary action. For IG it opens the DM thread itself — the opener is
// on the clipboard, the compose box is one paste away. ...
function primaryAction() {
  if (!lead) return;
  copyOpener();
  if (channel === "ig") {
    const url = lead.ig_username
      ? igDmUrl(lead.ig_username)
      : lead.ig_profile_url ?? (lead.ig_username ? igProfileUrl(lead.ig_username) : null);
    if (url) window.open(url, "_blank");
  } ...
```

Replace the IG branch (and fix the stale comment — it claims a DM thread opens, which was never true):

```ts
// THE primary action: copy the opener, open the prospect's PROFILE.
// (A /direct/t/<username> "open the thread" URL doesn't exist — /direct/t/
// takes a numeric thread id, so it lands on the Messages inbox. Profile +
// opener-on-clipboard is the accurate flow; the rep taps Message there.)
function primaryAction() {
  if (!lead) return;
  copyOpener();
  if (channel === "ig") {
    const url = igOpenUrl(lead);
    if (url) window.open(url, "_blank");
  } ...
```

- Update the import at line 8: remove `igDmUrl`, add `igOpenUrl` (keep `IgHandle`, `igProfileUrl` if still referenced, `LeadPlus`).
- Update the button label (line ~437): `<><span>Copy opener</span><span className="opacity-70">+ Open DM</span></>` → `<><span>Copy opener</span><span className="opacity-70">+ Open profile</span></>`.

## BUILD 3 — `app/leads/[id]/page.tsx`: "IG →" link, username-first + no more vanishing

Current (lines 63–72) — trusts raw stored URL, renders nothing when `ig_profile_url` is null even though `ig_username` exists:

```tsx
{lead.ig_profile_url && (
  <a
    href={lead.ig_profile_url}
    target="_blank"
    rel="noopener noreferrer"
    className="text-xs text-pink-500 hover:underline"
  >
    IG &rarr;
  </a>
)}
```

Replace with (import `igOpenUrl` from `@/components/ig` — the file already imports `IgHandle` from there):

```tsx
{igOpenUrl(lead) && (
  <a
    href={igOpenUrl(lead)!}
    target="_blank"
    rel="noopener noreferrer"
    className="text-xs text-pink-500 hover:underline"
  >
    IG &rarr;
  </a>
)}
```

## BUILD 4 — `app/api/ig-events/route.ts`: canonicalize at write + stop nulling good URLs

Two problems in the `IG_PROFILE_SAVE` handler:
1. `ig_profile_url: profileUrl ?? null` stores whatever the extension sends, unvalidated.
2. The extension's `saveLead` currently sends **no** `profileUrl` field at all — so every RE-SAVE of an already-researched lead **overwrites a good Apify URL with `null`** on the update path.

In both the update branch (`ig_profile_url: profileUrl ?? null`, ~line 83) and the insert branch (~line 106), derive the canonical URL from the username server-side:

```ts
// Canonical profile URL from the handle — never trust the client's page URL.
// Falls back to the client value only for a (theoretical) username-less save.
const canonicalIgUrl = username
  ? `https://www.instagram.com/${String(username).replace(/^@/, "")}/`
  : (profileUrl ?? null);
```

Then in the **update** branch use `ig_profile_url: canonicalIgUrl ?? undefined` (undefined = leave existing value alone rather than nulling it), and in the **insert** branch `ig_profile_url: canonicalIgUrl`.

Do NOT change the `saveEvent.postUrl` line (`postUrl: profileUrl ?? pageUrl ?? null`) — event history keeps the raw page URL on purpose.

---

## VERIFICATION
1. `npm run build` — clean, zero type errors.
2. `grep -rn "igDmUrl\|/direct/t/" app components lib hooks` → zero hits.
3. `grep -rn "instagram.com/direct" app components lib` → zero hits.
4. Dev-run `/outreach`: the pink button reads "Copy opener + Open profile"; click → new tab at `https://www.instagram.com/<handle>/` (the profile), opener on clipboard. Check a lead detail page: "IG →" opens the profile; still shows for a lead whose `ig_profile_url` is null but has a username.
5. POST a fake `IG_PROFILE_SAVE` (or re-save a lead via the extension later) and confirm the row's `ig_profile_url` is the canonical URL, and that re-saving a lead that already had a URL does not null it.

## COORDINATES WITH
- **T2 (instagram.js)** and **T3 (sidepanel.js)** apply the same username-first rule in the extension's own copies of the URL helpers. No shared files with you.
- Your changes ship on `git push` (Vercel auto-deploy) — independent of the extension's Web Store cycle.

When done, write `HANDOFF_IGOPEN_T1.md`: what you changed, any deviations, build status.
