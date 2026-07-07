# FIX_IGOPEN — Terminal 3: SIDEPANEL (`sidepanel.js` + `styles.css` + `manifest.json`)

## MISSION
Make the sidepanel's Instagram opens land where the rep expects (right tab, right window, always the profile) and make the account pill honest (no stale account shown as "correct", no false "wrong" when the rep simply hasn't set a personal IG). Bump the extension to 2.12.0.

Audit artifact: https://claude.ai/code/artifact/228f776a-4338-49da-b3f4-1826a16b9017

## FILES YOU OWN
- `chrome-extension/ig-lead-tracker/sidepanel.js`
- `chrome-extension/ig-lead-tracker/styles.css`
- `chrome-extension/ig-lead-tracker/manifest.json`

## DO NOT TOUCH
- `instagram.js` (T2), `background.js`, `page-interceptor.js`, `sidepanel.html`, `popup.js`
- Any dashboard file (T1 owns `components/ig.tsx`, `app/outreach/page.tsx`, `app/leads/[id]/page.tsx`, `app/api/ig-events/route.ts`)

## CONTRACTS
- Canonical profile URL = `https://www.instagram.com/<handle>/` — username-first; stored `ig_profile_url` only when no username.
- **You CONSUME from T2:** `instagram.js` gains a `FB_RECHECK_ACCOUNT` runtime-message handler that re-runs account detection. You send it (BUILD 3). Exact type string: `FB_RECHECK_ACCOUNT`.
- Storage keys (read-only for you, background.js writes them): `activeIgAccount`, `activeIgAccountTs`. Freshness contract: older than 5 minutes = stale (same `5 * 60 * 1000` the content script uses).

---

## BUILD 1 — `openInIgTab` (lines ~161–174): right tab, right window

Current — grabs `tabs[0]`, the first IG tab by browser order in ANY window, and force-focuses it (this is the "it hijacked my Messages tab" / "nothing happened" behavior):

```js
function openInIgTab(url) {
  if (!url) return;
  if (url.includes("instagram.com")) {
    chrome.tabs.query({ url: "*://www.instagram.com/*" }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { url, active: true });
      } else {
        chrome.tabs.create({ url });
      }
    });
  } else {
    chrome.tabs.create({ url });
  }
}
```

Replace with current-window preference:

```js
function openInIgTab(url) {
  if (!url) return;
  if (!url.includes("instagram.com")) { chrome.tabs.create({ url }); return; }
  // Prefer the tab the rep is looking at; then any IG tab in THIS window;
  // never commandeer an IG tab in another window (looks like nothing happened).
  chrome.tabs.query({ active: true, currentWindow: true }, ([activeTab]) => {
    if (activeTab?.url?.includes("instagram.com")) {
      chrome.tabs.update(activeTab.id, { url });
      return;
    }
    chrome.tabs.query({ url: "*://www.instagram.com/*", currentWindow: true }, (tabs) => {
      if (tabs.length > 0) chrome.tabs.update(tabs[0].id, { url, active: true });
      else chrome.tabs.create({ url });
    });
  });
}
```

## BUILD 2 — `igUrl` (lines ~148–150): username-first

Current: `return lead.ig_profile_url || igProfileUrl(lead.ig_username);`

```js
function igUrl(lead) {
  // Username-first: ig_profile_url is captured/imported data — only trust it
  // when there's no handle to build from.
  return igProfileUrl(lead.ig_username) || lead.ig_profile_url || null;
}
```

(`igProfileUrl` at line ~144 already returns `null` for a missing handle — no other change needed. This automatically fixes the outreach "📸 Open IG (+ Copy)" button, the Follow-ups Open button, and Prev/Next, which all route through `igUrl` → `openInIgTab`.)

## BUILD 3 — `updateAccountPill` (lines ~296–315): honest states

Current bugs: reads `activeIgAccount` but never `activeIgAccountTs` (stale handle shown as current, possibly "correct" after a switch); unset personal IG makes the rep's own account show "wrong" (pink) forever.

Replace the function:

```js
const ACCOUNT_MAX_AGE_MS = 5 * 60 * 1000; // same freshness contract as instagram.js

async function updateAccountPill() {
  const { activeIgAccount = "", activeIgAccountTs = 0 } =
    await chrome.storage.local.get({ activeIgAccount: "", activeIgAccountTs: 0 });
  const pill = document.getElementById("account-pill");
  const label = document.getElementById("account-label");
  if (!pill || !label) return;
  if (!activeIgAccount) { pill.style.display = "none"; return; }
  pill.style.display = "flex";

  const stale = !activeIgAccountTs || Date.now() - activeIgAccountTs > ACCOUNT_MAX_AGE_MS;
  if (stale) {
    // Don't vouch for a detection older than the freshness contract — show
    // checking state and ask the content script to re-detect (T2's handler).
    label.textContent = `@${activeIgAccount} · checking…`;
    pill.className = "account-pill unknown";
    pill.title = "Re-checking which Instagram account is active";
    chrome.tabs.query({ url: "*://www.instagram.com/*", currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { type: "FB_RECHECK_ACCOUNT" }).catch(() => {});
    });
    return;
  }

  label.textContent = `@${activeIgAccount}`;
  const cleanFb = fanbasisHandle.replace(/^@/, "").toLowerCase();
  const cleanPers = personalIgUsername.replace(/^@/, "").toLowerCase();
  const activeAcct = activeIgAccount.toLowerCase();
  if ((cleanFb && activeAcct === cleanFb) || (cleanPers && activeAcct === cleanPers)) {
    pill.className = "account-pill correct";
    pill.title = "";
  } else if (cleanFb && cleanPers) {
    pill.className = "account-pill wrong";
    pill.title = "Not one of your configured accounts";
  } else {
    // Only one (or neither) identity configured — an unrecognized account is
    // "unknown", not "wrong": don't cry wolf at reps without a personal IG set.
    pill.className = "account-pill unknown";
    pill.title = "Set your personal Instagram in dashboard Settings → Extension to track both accounts";
  }
}
```

Note the storage-change listener at line ~1450 already re-runs `updateAccountPill` on `activeIgAccount` changes — verify it also fires on `activeIgAccountTs` change; if it filters to specific keys, add `activeIgAccountTs`.

## BUILD 4 — `styles.css`: the `unknown` pill state

After the existing pill rules (lines ~329–334), add:

```css
.account-pill.unknown { border-color: #f59e0b44; background: #f59e0b11; color: #f59e0b; }
.account-pill.unknown .account-dot { background: #f59e0b; }
```

## BUILD 5 — don't clobber an open booking overlay (renderOutreach, line ~778)

`renderOutreach()` already guards the notes textarea:

```js
function renderOutreach() {
  // Don't clobber the notes textarea mid-typing — blur triggers a save + re-render
  if (document.activeElement && document.activeElement.id === "leadNotes") return;
```

Add the overlay guard right below it (the booking/availability overlay is `#sp-book-overlay`, shown with `display:flex` at line ~765; the 3-min background alarm plus several events trigger full re-renders that currently wipe it mid-booking):

```js
  // Don't re-render while the booking overlay is open — a background refresh
  // mid-booking wipes the rep's slot selection.
  const bookOverlay = document.getElementById("sp-book-overlay");
  if (bookOverlay && bookOverlay.style.display !== "none" && bookOverlay.style.display !== "") return;
```

(Check how the overlay is initialized: if it starts with no inline display, treat only `display:flex` as open — adjust the condition to `bookOverlay.style.display === "flex"` if that's cleaner. The point: an OPEN overlay blocks re-render; a closed one doesn't.)

## BUILD 6 — snap-back guard: panel-driven navigation wins for 2.5 s

Prev/Next (lines ~1205–1218) drive the IG tab, which re-fires `chrome.tabs.onUpdated` (line ~344), which calls `loadData()` + re-syncs `outreachIdx` — the loop can yank the card away from where the rep just navigated. Give panel-driven navs a grace window:

- Module level (near `let outreachIdx`): `let panelNavUntil = 0;`
- In BOTH the `prevBtn` and `nextBtn` handlers, before `openInIgTab(url)`: `panelNavUntil = Date.now() + 2500;`
- At the top of the `chrome.tabs.onUpdated` re-sync (inside the debounced callback, before the `loadData().then(...)` block, line ~360): 

```js
if (Date.now() < panelNavUntil) return; // panel drove this navigation — don't re-sync against it
```

- Same one-line guard at the top of the `FB_PROFILE_ACTIVE` branch of the `chrome.runtime.onMessage` listener (line ~1463).

## BUILD 7 — `manifest.json`: version 2.11.0 → **2.12.0**

Only the version line. Name, permissions, hosts stay untouched.

---

## VERIFICATION
1. `node --check chrome-extension/ig-lead-tracker/sidepanel.js` — clean.
2. `grep -n "tabs\[0\]" sidepanel.js` → only inside the currentWindow-scoped queries.
3. Load unpacked with TWO windows, an IG Messages tab in the other window: sidepanel "Open" uses/creates a tab in YOUR window, never touches the other window's tab.
4. Pill: fresh detection shows green/pink as before; after 5+ min idle it flips to amber "checking…" and recovers when the IG tab responds; with no personal IG configured, browsing your personal account shows amber "unknown", NOT pink "wrong".
5. Open the 📅 Book overlay, wait for a background refresh (or trigger `loadData()` from console) → overlay and slot selection survive.
6. Prev/Next through 5 leads quickly → card never snaps back to a previous lead.

## COORDINATES WITH
- **T2** provides the `FB_RECHECK_ACCOUNT` handler in `instagram.js` (their BUILD 6). If your test runs before T2 lands, the sendMessage just no-ops — the pill still shows "checking…" correctly.
- **T1**'s dashboard fixes are independent of you.
- Integration (after all 3 handoffs): `node --check` both JS files, `npm run build`, repackage `public/extension/fanbasis-extension.zip`, update `public/extension/latest.json` → 2.12.0, then Felipe uploads to the Web Store (2.12.0 supersedes the not-yet-uploaded 2.11.0).

When done, write `HANDOFF_IGOPEN_T3.md`: what you changed, any deviations, verification results.
