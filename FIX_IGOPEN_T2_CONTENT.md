# FIX_IGOPEN — Terminal 2: CONTENT SCRIPT (`instagram.js` only)

## MISSION
Fix the extension's two accuracy failures on the Instagram page itself: (1) the DM flow's dead-end fallback that navigates to the retired `instagram.com/direct/new/?username=` endpoint (Instagram now redirects it to the Messages inbox — this is the extension's "goes to Messages" bug), and (2) the account-switch machinery that can click the wrong account and leak listeners. All fixes live in ONE file.

Audit artifact: https://claude.ai/code/artifact/228f776a-4338-49da-b3f4-1826a16b9017

## FILES YOU OWN
- `chrome-extension/ig-lead-tracker/instagram.js` — ONLY this file.

## DO NOT TOUCH
- `sidepanel.js`, `styles.css`, `manifest.json` (T3), `background.js`, `page-interceptor.js`, `sidepanel.html`, `popup.js` (nobody this wave)
- Any dashboard file (T1 owns `components/ig.tsx`, `app/outreach/page.tsx`, `app/leads/[id]/page.tsx`, `app/api/ig-events/route.ts`)
- If you need styles, use the existing injected-`<style>` pattern (`injectStyles`, `#fb-card-styles`) — never `styles.css`.

## CONTRACTS
- Canonical profile URL = `https://www.instagram.com/<handle>/` — username-first everywhere; stored `ig_profile_url` only as fallback when no username.
- **You PROVIDE to T3:** a `FB_RECHECK_ACCOUNT` runtime-message handler (BUILD 6). T3's sidepanel sends it when its account pill data is stale. Do not rename it.
- Existing helpers you'll reuse (already in this file): `extractUsernameFromUrl()`, `FB_PENDING_KEY = "fb_pendingDm"` (line ~173), `clearPendingDm()` (line ~193), `freshActiveIgAccount()` (line ~378), `removeCard()` (line ~627).

---

## BUILD 1 — `openIgDm` (lines ~523–544): never navigate to `/direct/new`

Current — the bug:

```js
function openIgDm(username) {
  let tries = 0;
  function attempt() {
    const btn = Array.from(
      document.querySelectorAll('[role="button"], button, div[tabindex="0"]')
    ).find(el =>
      el.textContent.trim() === "Message" ||
      el.getAttribute("aria-label") === "Message"
    );
    if (btn) { btn.click(); return; }
    if (++tries < 6) {
      setTimeout(attempt, 400);
    } else {
      try { localStorage.setItem("fb_auto_dm_confirm", "1"); } catch {}
      window.location.href = `https://www.instagram.com/direct/new/?username=${encodeURIComponent(username)}`;
    }
  }
  attempt();
}
```

`/direct/new/?username=` is retired — Instagram 302s it to the inbox. Replace the exhausted-retries branch with a **one-shot profile retry**:

```js
} else {
  // /direct/new/?username= is retired — IG redirects it to the Messages
  // inbox. Instead: if we're not on the profile, go there once and retry
  // the Message click after load; if we ARE on the profile and still
  // can't find the button, tell the rep instead of stranding them.
  const onProfile = (extractUsernameFromUrl() || "").toLowerCase() === username.toLowerCase();
  let retried = false;
  try { retried = localStorage.getItem("fb_dm_retry") === username.toLowerCase(); } catch {}
  if (!onProfile && !retried) {
    try { localStorage.setItem("fb_dm_retry", username.toLowerCase()); } catch {}
    window.location.href = `https://www.instagram.com/${encodeURIComponent(username)}/`;
  } else {
    try { localStorage.removeItem("fb_dm_retry"); } catch {}
    showDmFallbackNotice(username);
  }
}
```

Add the retry consumption in `updateCardForProfile` (near the pendingDm block, ~line 2763): when the current profile matches a fresh `fb_dm_retry` flag, clear the flag and call `openIgDm(username)` once. Guard with a timestamp if you prefer (`fb_dm_retry` value `username|ts`, expire after 2 min) — the point is: **at most one automated retry, never a loop**.

Add `showDmFallbackNotice(username)`: a small toast on the FB card (or `alert`-free inline banner) — "Couldn't auto-open the DM — tap **Message** on this profile. Your opener is on the clipboard." Reuse the card's injected-style toast pattern.

## BUILD 2 — switcher row selection (lines ~265–281): exact handle match, no substring clicks

Current — the bug (`john` matches `johnsmith`):

```js
if (!(node.textContent || "").toLowerCase().includes(clean)) continue;
walkToClickable(node).click();
```

Replace with a two-pass match: exact handle token first; `.includes` only as a fallback and only when it's unambiguous:

```js
const rows = [];
for (const node of candidates) {
  if (!node.offsetParent) continue;
  if (node.getBoundingClientRect().height < 4) continue;
  const text = (node.textContent || "").toLowerCase();
  // Exact token match — "@john" or "john" as its own word, not a substring
  // of another handle (john ⊄ johnsmith).
  const tokens = text.split(/[\s@·]+/).filter(Boolean);
  if (tokens.includes(clean)) { walkToClickable(node).click(); if (onPhaseChange) onPhaseChange("done"); clearInterval(timer); return; }
  if (text.includes(clean)) rows.push(node);
}
// Fallback for display-name-only rows ("Felipe Guimaraes"): only safe when
// exactly ONE row matched — two matches means ambiguity, let the rep click.
if (rows.length === 1) {
  walkToClickable(rows[0]).click();
  if (onPhaseChange) onPhaseChange("done");
  clearInterval(timer);
  return;
}
```

## BUILD 3 — switch-completion cleanup on navigation (fix the listener leak)

`renderSwitchPrompt` (~lines 886–920) registers `chrome.storage.onChanged.addListener(storageWatcher)` and its `cleanup()` only runs on the explicit button paths. If the card is torn down by navigation (`removeCard()`, line ~627), the listener leaks and can fire a phantom "switch complete" later.

- Add a module-level registry near the top of the card-lifecycle section:

```js
let activeSwitchCleanup = null; // set by renderSwitchPrompt, called on card teardown
```

- In `renderSwitchPrompt`, right after `function cleanup() {...}` is defined: `activeSwitchCleanup = cleanup;` and inside `cleanup()` add `activeSwitchCleanup = null;`.
- In `removeCard()`:

```js
function removeCard() {
  document.getElementById("fb-tracker-card")?.remove();
  clearInterval(pollTimer);
  pollTimer = null;
  if (activeSwitchCleanup) activeSwitchCleanup(); // don't leak the storage watcher across navigations
}
```

The existing `storageCleanedUp` flag already makes `cleanup()` idempotent — keep it; it also serves as the race guard between the three completion detectors (auto-click, storage watcher, manual button): whichever completes first, the others no-op.

## BUILD 4 — `saveLead` (lines ~576–611): send a canonical profileUrl

Current payload has `pageUrl: window.location.href` and NO `profileUrl` — so the server stores whatever it gets (T1 is hardening the server side; you fix the source):

```js
const payload = {
  type: "IG_PROFILE_SAVE",
  username,
  userId: "",
  pageUrl: window.location.href,
  profileUrl: `https://www.instagram.com/${String(username).replace(/^@/, "")}/`,
  bio,
  followerCount,
  displayName,
  savedFromAccount,
};
```

Keep `pageUrl` as-is (event history uses it). Just ADD the canonical `profileUrl` line.

## BUILD 5 — Next/Skip/Snooze navigation: username-first (4 spots)

All four currently prefer the stored URL: `nextLead.ig_profile_url || `https://www.instagram.com/${nextLead.ig_username}/`` — at lines ~1971, ~2146, ~2160–2166, ~2711. Flip each to username-first:

```js
const nextUrl = nextLead.ig_username
  ? `https://www.instagram.com/${nextLead.ig_username}/`
  : nextLead.ig_profile_url;
```

(For the inline `window.location.href = ...` snooze/skip/next cases, extract the same expression.) Grep after: `grep -n "ig_profile_url ||" instagram.js` → zero hits.

## BUILD 6 — `FB_RECHECK_ACCOUNT` message handler (contract with T3)

In the existing `chrome.runtime.onMessage` listener (the one handling `CLICK_DM_BTN`, ~line 2853), add:

```js
if (msg?.type === "FB_RECHECK_ACCOUNT") {
  // Sidepanel's account pill went stale — kick a fresh viewer detection.
  document.dispatchEvent(new CustomEvent("ig_viewer_check", { bubbles: true, composed: true }));
}
```

## BUILD 7 — pending-DM redirect: at most once (lines ~2767–2773)

Current: any pending DM < 10 min old redirects EVERY non-matching profile load to `pending.profile` — so a rep who deliberately opens a different profile gets bounced. Add a single-redirect guard:

```js
if (pending && Date.now() - pending.ts < 600000) {
  const currentUser = extractUsernameFromUrl();
  if (currentUser !== pending.profile) {
    if (pending.redirected) {
      // Already bounced once and the rep navigated elsewhere anyway —
      // they chose a different page; stop fighting them.
      clearPendingDm();
    } else {
      pending.redirected = true;
      try { localStorage.setItem(FB_PENDING_KEY, JSON.stringify(pending)); } catch {}
      window.location.href = `https://www.instagram.com/${pending.profile}/`;
      return;
    }
  } else {
    autoDm = pending.channel;
    ...
```

(Keep the on-profile consumption branch exactly as it is.)

## BUILD 8 — SPA watcher: stop double-watching (lines ~2836–2840)

The 800 ms poll runs even when the Navigation API is active. Gate it:

```js
if (window.navigation) {
  window.navigation.addEventListener("navigate", () => setTimeout(handleUrlChange, 50));
} else {
  // Fallback poll only for browsers without the Navigation API
  setInterval(handleUrlChange, 800);
}
```

---

## VERIFICATION
1. `node --check chrome-extension/ig-lead-tracker/instagram.js` — clean.
2. `grep -n "direct/new" instagram.js` → zero hits. `grep -n "ig_profile_url ||" instagram.js` → zero hits.
3. Load unpacked, on a lead's profile: Send-DM works when the Message button exists; with the button hidden (test by renaming in devtools), you land on the PROFILE with the notice — never the Messages inbox, and no redirect loop.
4. Account switch prompt: switch via IG's UI → completes once, no double-fire; navigate away mid-prompt, then switch accounts → no phantom completion (watcher removed).
5. Save a lead → network tab shows `profileUrl: "https://www.instagram.com/<handle>/"` in the POST body.

## COORDINATES WITH
- **T3** sends `FB_RECHECK_ACCOUNT` (you provide the handler in BUILD 6) and bumps the manifest to 2.12.0 — do NOT touch `manifest.json` yourself.
- **T1** canonicalizes `ig_profile_url` server-side — your BUILD 4 is the belt to their braces.
- Integration (after all 3 handoffs): `node --check` both JS files, repackage `public/extension/fanbasis-extension.zip`, update `public/extension/latest.json` → 2.12.0.

When done, write `HANDOFF_IGOPEN_T2.md`: what you changed, any deviations, verification results.
