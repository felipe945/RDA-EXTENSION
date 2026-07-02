# CONNECT · Terminal 2 — EXTENSION / CLIENT (ig-lead-tracker)

**Goal of the wave:** cut extension setup from ~15 steps to **one Google sign-in**. You own the extension: the sign-in flow, self-bootstrapping, deleting the extension's own Google OAuth, and turning the settings form into a status panel. Terminal 1 owns the dashboard endpoints you call. You never touch `app/**` or `lib/**`; T1 never touches `chrome-extension/**`.

Working dir: `/Users/felipe/unified-sales-ops/chrome-extension/ig-lead-tracker`

---

## Adopted defaults (decided 2026-07-02 — flag Felipe only if you hit a wall)
- **Option A** (self-contained) · **bookings → rep's personal calendar** (unchanged behavior, now via T1's server route) · **sign-in** = in-panel "Sign in with Google" button using `chrome.identity.launchWebAuthFlow`.

---

## FROZEN CONTRACTS (identical block in both files — do not change unilaterally)

**C1 — Auth handoff (T1 mints, you consume).** Call `chrome.identity.launchWebAuthFlow({ url: <dashboard>/api/extension/auth/start?ext_redirect=<R>, interactive:true })` where `R = chrome.identity.getRedirectURL()` (a `*.chromiumapp.org/` URL). Final redirect is `<R>#token=<repToken>`; parse `#token`, store as `fb_rep_token` in `chrome.storage.local`. Send `Authorization: Bearer <fb_rep_token>` on **every** dashboard call. repToken is a 90-day JWT — treat 401 as "signed out → show Sign in."

**C2 — Bootstrap.** `GET /api/extension/bootstrap` (Bearer) →
```json
{ "ok": true, "dashboardUrl":"...", "fanbasisHandle":"fanbasis",
  "rep": { "id":"...","email":"...","name":"...","personalIgUsername":"..." },
  "calendar": { "connected": true, "slotMins": 30, "timezone":"..." } }
```
`401` → prompt sign-in.

**C3 — Calendar (Bearer on both).**
- `GET /api/calendar/slots?days=7&slotMins=30` → `{ ok:true, slots:[{start,end}] }`
- `POST /api/calendar/book` `{ slotStart, slotEnd, leadName, guestEmail? }` → `{ ok:true, eventId, htmlLink }`
- `{ ok:false, needsCalendar:true }` → prompt a re-sign-in to upgrade Google scope.

**C4 — ig-events identity.** Send Bearer repToken on `POST /api/ig-events` (keep sending `x-ig-secret` too until T1 confirms Bearer is live — belt and suspenders during rollout).

---

## Tasks

### Task 1 — sign-in flow (`background.js`)
Add a `SIGN_IN` message handler: run C1's `launchWebAuthFlow`, parse `#token`, store `fb_rep_token`, then immediately call bootstrap (Task 2). Add a helper `authHeader()` that returns `{ Authorization: "Bearer " + fb_rep_token }` and use it on **all** `${dashboardUrl}/api/*` fetches (search current `fetch(\`${dashboardUrl}` sites). Manifest: ensure `"identity"` permission is present and `host_permissions` includes the dashboard (it does — `unified-sales-ops.vercel.app`).

### Task 2 — self-bootstrap, kill the 6 manual fields (`background.js` + `sidepanel.js`)
- On startup (and right after sign-in), if `fb_rep_token` exists, `GET /api/extension/bootstrap` and cache the result into `chrome.storage.local` (`fb_bootstrap`). Use its values for `dashboardUrl`, `fanbasisHandle`, `personalIgUsername`, calendar `slotMins` instead of the `storage.sync` settings read at `background.js:146`.
- `dashboardUrl` still defaults to the hardcoded prod URL if bootstrap hasn't run — never leave it blank.
- Remove reliance on manually-entered `igSecret` for identity (T1's Bearer path replaces it); you may keep sending the secret header during transition per C4.

### Task 3 — delete the extension's own Google OAuth (`background.js`)
Remove `GCAL_CLIENT_ID` (`:14`), `GCAL_REDIRECT` (`:15`), `getCalToken()` (`:23`), `CONNECT_CALENDAR` (`:409`), `DISCONNECT_CALENDAR` (`:468`), and the `cal_token/cal_token_exp/cal_calendars/cal_user_name` storage. The extension must never run its own Google OAuth again.

### Task 4 — booking via the dashboard (`background.js` + `instagram.js`)
Rewrite the two calendar message handlers to call T1's routes with `authHeader()`, keeping the **same message names** so `instagram.js` booking UI (`~:1153-1245`) barely changes:
- `GET_CALENDAR_SLOTS` (`:523`) → `GET /api/calendar/slots` (C3). On `{needsCalendar:true}` → tell the UI to show "Connect calendar" which triggers `SIGN_IN`.
- `CREATE_CALENDAR_EVENT` (`:492`) → `POST /api/calendar/book` (C3).
Delete the direct `googleapis.com/calendar` fetches (`:509`, `:523` region).

### Task 5 — status panel, not a form (`sidepanel.html` + `sidepanel.js`) — this is M4
Replace the settings/details form (`sidepanel.html ~:95-152`, incl. the `calConnectBtn` at `:118-119` and the dashboardUrl/igSecret/handle inputs) with a **read-only status readout**:
```
● Signed in as {rep.name}      [Sign out]
● Calendar connected           (or:  ⚠ Calendar not connected  [Connect])
● Team: FanBasis
```
Before sign-in, show a single primary **"Sign in with Google"** button (fires `SIGN_IN`). A "Reconnect" affordance appears only on 401/`needsCalendar`. No text inputs.

### Task 6 — manifest version
Bump `manifest.json` `version` `2.1.0 → 2.2.0` (Web Store Unlisted auto-update).

---

## Test checklist (load unpacked; you can stub T1 with a local mock or the deployed dev routes)
- [ ] Fresh install → side panel shows only "Sign in with Google."
- [ ] Click it → Google flow → panel flips to "Signed in as … / Calendar connected." No URL, secret, or handle ever typed.
- [ ] Book from an IG lead card → slots come from `/api/calendar/slots`; picking one creates the event via `/api/calendar/book`.
- [ ] Revoke/expire token (clear `fb_rep_token`) → next action shows "Sign in" (401 handled), no crash.
- [ ] Grep confirms `GCAL_CLIENT_ID`, `getCalToken`, `CONNECT_CALENDAR`, `cal_token` are all gone.
- [ ] `node --check background.js instagram.js sidepanel.js` passes.

## Done when
A new rep signs in once with Google and everything auto-provisions; the extension runs no Google OAuth of its own; booking flows through the dashboard; the settings form is a status panel; manifest at 2.2.0. Commit + push.

---

## Integration — after BOTH terminals land (T1 drives, same as before)
1. Merge (no file overlap → no conflicts). 2. Felipe applies migration `014` (SQL editor). 3. Add `EXTENSION_TOKEN_SECRET` to Vercel. 4. End-to-end on a real rep account: one sign-in → bootstrap + calendar + an ig-event stamped with `rep_id`. 5. Then Web Store upload of 2.2.0.
