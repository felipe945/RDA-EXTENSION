# CONNECT · T2 Summary — Extension (v2.2.0)

**Status: SHIPPED** — commit `2ea8e30`, pushed to main 2026-07-02.
Goal delivered: extension setup went from ~15 manual steps to **one Google sign-in**. The extension no longer runs any Google OAuth of its own.

---

## What changed (by task)

### 1 · Sign-in flow — `background.js`
- New `SIGN_IN` handler: `chrome.identity.launchWebAuthFlow` → dashboard's `/api/extension/auth/start?ext_redirect=<chromiumapp.org URL>` → parses `#token=<repToken>` from the final redirect (contract C1).
- Token stored as `fb_rep_token` in `chrome.storage.local` (90-day JWT minted by the dashboard).
- Also added `SIGN_OUT` and `REFRESH_BOOTSTRAP` handlers.
- Any 401 from the dashboard = signed out → token + bootstrap cleared → panel shows "Sign in."

### 2 · Self-bootstrap — kills the 6 manual fields
- After sign-in and on every service-worker startup, fetches `GET /api/extension/bootstrap` (Bearer) and caches the result as `fb_bootstrap` (contract C2).
- `getSettings()` (background **and** instagram.js) now resolves `dashboardUrl`, `fanbasisHandle`, `personalIgUsername`, and `slotMins` from bootstrap first, legacy `storage.sync` second, hardcoded prod URL last — never blank.
- Fields eliminated: dashboardUrl, igSecret, fanbasisHandle, personalIgUsername, cal_selected, cal_slot_mins. **Zero typed input remains.**

### 3 · Extension's own Google OAuth — deleted
Gone: `GCAL_CLIENT_ID` / `GCAL_REDIRECT` / `GCAL_SCOPES`, `getCalToken()`, `CONNECT_CALENDAR`, `DISCONNECT_CALENDAR`, `GET_CALENDAR_LIST`, `SAVE_CALENDAR_SETTINGS`, client-side free/busy slot math, the manifest `oauth2` block, and the `googleapis.com` host permission.
An `onInstalled` hook purges stale `cal_token` / `cal_calendars` / `cal_user_name` storage from already-installed copies.

### 4 · Booking via the dashboard — same message names
- `GET_CALENDAR_SLOTS` → `GET /api/calendar/slots?days=7&slotMins=…`
- `CREATE_CALENDAR_EVENT` → `POST /api/calendar/book` (response's `htmlLink` mapped to the old `eventLink` field)
- Booking UIs in `instagram.js` (~lines 1153–1245) and the sidepanel slot picker needed almost no changes.
- On `{needsCalendar:true}` or 401: all three "📅 Book a Call" buttons flip to **"🔗 Connect calendar"**; clicking re-runs `SIGN_IN` to upgrade the Google scope.

### 5 · Status panel, not a form — `sidepanel.html` / `sidepanel.js`
- Fresh install: full-panel gate with a single **"Sign in with Google"** button (Google-logo SVG, error line for failed auth).
- Signed in: ⚙ Account section is a read-only readout —
  `● Signed in as {rep.name} [Sign out]` / `● Calendar connected` (or `⚠ not connected [Connect]`) / `● Team: FanBasis (@handle)`.
- Old settings form + Google Calendar picker (~120 lines) deleted. No text inputs anywhere.

### 6 · Manifest
`2.1.0 → 2.2.0` (Web Store Unlisted auto-update). `identity` permission kept (needed for `launchWebAuthFlow`).

### C4 · Identity on every call
Every `${dashboardUrl}/api/*` fetch in **all** scripts (background, instagram, sidepanel — leads, notifications, messages, touchpoints, ig-events, opener, research-lead) now sends `Authorization: Bearer <repToken>`. `x-ig-secret` still rides along on ig-events during rollout — belt and suspenders until T1 confirms Bearer-only.

---

## Verification done
- `node --check` passes on background.js, instagram.js, sidepanel.js, popup.js, dashboard.js; manifest JSON-validated.
- Grep-clean: `GCAL_CLIENT_ID`, `getCalToken`, `CONNECT_CALENDAR`, `cal_token` all gone (except the intentional one-time storage cleanup).
- Live checks (real sign-in, real booking, 401 recovery) deferred to integration — they need T1's deployed routes + migration 014.

## Integration state (T1 shipped `0d0ad9f`) — remaining blockers
1. **Felipe applies migration 014** (`supabase/migrations/014_extension_identity.sql`) in the Supabase SQL editor.
2. Each rep **re-signs in to Google once** (consent now grants calendar scopes → refresh token lands server-side).
3. Post-014 end-to-end: sign in → bootstrap → real slots → real booking → ig-event stamped with `rep_id`.
4. **Web Store upload of 2.2.0.**
