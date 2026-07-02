# Chrome Web Store Submission — FanBasis Sales extension

Everything is prepped. Your part is ~15 minutes; then a review wait (first
submission with IG/LinkedIn host permissions: typically a few days, sometimes
up to ~2 weeks; subsequent updates usually clear in <24h and roll out
silently — that's the whole point).

**Why the ID change is safe (already verified):** extension sign-in is
brokered by the dashboard (`/api/extension/auth/start`), which accepts any
`https://<id>.chromiumapp.org` redirect. No Google OAuth client references
the extension ID. Publishing assigns a new ID and nothing breaks.

## Step 0 — build the store zip (already done, or re-run any time)

```
npm run pack:webstore     →  dist/fanbasis-extension-webstore.zip
```

This is the same code as the team build minus: the `key` field (CWS rejects
it), localhost, and the legacy Twitter/ManyChat/AgoraPulse surfaces (fewer
permissions = faster review). The unpacked team build is unchanged.

## Step 1 — developer account ($5, one-time)

https://chrome.google.com/webstore/devconsole → sign in as
**felipe@fanbasis.com** → pay the $5 registration fee.

## Step 2 — create the item

"New item" → upload `dist/fanbasis-extension-webstore.zip`.

## Step 3 — Store listing tab (paste-ready)

- **Name:** FanBasis Sales
- **Summary (132 max):**
  `FanBasis internal sales cockpit — capture Instagram leads, work the outreach queue, and book AE calls without leaving IG.`
- **Description:**
  ```
  Internal tool for the FanBasis sales team. Requires an invited
  @fanbasis.com account — it does nothing without one.

  • Save Instagram profiles as leads with one click; AI research runs
    automatically in the FanBasis dashboard.
  • Work the outreach queue (openers, scripts, follow-ups) from a side
    panel directly on instagram.com.
  • See a teammate AE's real calendar availability and book discovery
    calls without leaving the conversation.
  • Reply detection keeps lead stages in sync with actual DMs.
  ```
- **Category:** Productivity → Workflow & Planning
- **Language:** English
- **Icon:** already in the zip (128px). Store also asks for a 128×128 PNG on
  the listing — use `chrome-extension/ig-lead-tracker/icon128.png`.
- **Screenshots (required, ≥1, 1280×800):** take two —
  1. instagram.com with the side panel open on the Outreach tab
  2. an IG profile with the hover card showing fit score + Book
  (Set your browser window wide, screenshot, crop to 1280×800.)

## Step 4 — Privacy tab (paste-ready)

- **Single purpose:**
  `Lets FanBasis sales team members capture Instagram leads into the company's internal sales dashboard, run their outreach queue, and book sales calls.`
- **Permission justifications:**
  | Permission | Justification |
  |---|---|
  | `storage` | Caches the signed-in rep's session token and settings locally. |
  | `alarms` | Periodically refreshes lead/notification data from the company dashboard. |
  | `notifications` | Notifies the rep when a tracked lead replies. |
  | `sidePanel` | The main UI — an outreach queue panel shown alongside instagram.com. |
  | `tabs` | Syncs the side panel with the Instagram profile in the active tab. |
  | `clipboardWrite` | One-click copy of outreach scripts and proposed call times. |
  | `identity` | Google sign-in handshake with the company dashboard (launchWebAuthFlow). |
  | host: instagram.com / i.instagram.com | Reads public profile info of prospects the rep chooses to save; shows the lead card UI on profiles. |
  | host: linkedin.com | Same lead capture for LinkedIn prospects. |
  | host: unified-sales-ops.vercel.app | The company's own dashboard API — where all data is sent. |
- **Remote code:** No, all code is packaged.
- **Data usage disclosures — check:** "Authentication information" (Google
  sign-in), "Personally identifiable information" (prospect names/handles the
  rep saves), "Website content" (public profile data from pages visited).
  For each: used for **app functionality** only. Certify: not sold, not
  transferred for unrelated purposes, not used for creditworthiness.
- **Privacy policy URL:** `https://unified-sales-ops.vercel.app/privacy`

## Step 5 — Distribution

- **Visibility: Unlisted.** (Installable by link only; invisible in search.
  Still auto-updates — that's what we're here for.)
- Submit for review. In the reviewer notes field, add:
  `Internal tool for FanBasis staff. Sign-in is restricted to invited
  members of our Google Workspace org, so a test login is not available;
  the extension is inert without one. Distribution is Unlisted, to our
  own team only.`

## After approval

1. Send Claude the Web Store URL (`https://chromewebstore.google.com/detail/<id>`).
2. Claude flips `/settings/extension` to a one-click "Add to Chrome" button
   (zip stays as fallback), and team members reinstall once from the store —
   after that, updates are silent and automatic.
3. Future releases: bump the manifest version, `npm run pack:webstore`,
   upload the new zip in the dev console. No more reload-the-unpacked-folder.
