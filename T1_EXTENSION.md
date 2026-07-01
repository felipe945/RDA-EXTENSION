# T1 — Chrome Extension: Full Overhaul
## Files Owned (touch ONLY these)
- `ig-lead-tracker/instagram.js`
- `ig-lead-tracker/page-interceptor.js`
- `ig-lead-tracker/background.js`
- `ig-lead-tracker/sidepanel.js`
- `ig-lead-tracker/sidepanel.html`
- `ig-lead-tracker/styles.css`
- `ig-lead-tracker/scripts-data.js`
- `ig-lead-tracker/manifest.json`
- DELETE: `chrome-extension/` directory (dead diverged copy — merge scripts first, then rm -rf)

## Context
The extension has ZERO account detection. It is blind to whether Felipe is on his FanBasis IG account or his personal account. The sidepanel shows leads without any research data (no fit score, no opener, no follower count). Stage colors are hardcoded to a single blue. The extension cache never re-syncs from the dashboard. There are two diverged extension directories (`ig-lead-tracker/` at root is the active one; `chrome-extension/ig-lead-tracker/` is a dead copy with different scripts-data.js content).

---

## FIX 1: Account Detection in page-interceptor.js
**Problem:** `page-interceptor.js` intercepts follow/like fetch calls but never reads the logged-in user.  
**Root cause:** Zero viewer detection logic in the file.  
**Fix:** In `page-interceptor.js`, after the existing `window.fetch` wrapper, also intercept responses containing the current user. Add:

```javascript
// Intercept IG viewer from XHR responses
const origOpen = XMLHttpRequest.prototype.open;
XMLHttpRequest.prototype.open = function(method, url, ...rest) {
  this._url = url;
  return origOpen.apply(this, [method, url, ...rest]);
};
const origSend = XMLHttpRequest.prototype.send;
XMLHttpRequest.prototype.send = function(...args) {
  this.addEventListener('load', function() {
    try {
      if (this._url && (this._url.includes('api/v1/accounts/current_user') || 
                         this._url.includes('graphql') || 
                         this._url.includes('api/v1/feed'))) {
        const data = JSON.parse(this.responseText);
        const username = data?.user?.username || data?.data?.user?.username || 
                         data?.graphql?.user?.username;
        if (username) {
          window.dispatchEvent(new CustomEvent('ig-viewer', { detail: { username } }));
        }
      }
    } catch {}
  });
  return origSend.apply(this, args);
};
```

Also add a DOM-based fallback in the `window.fetch` override — after any response, check:
```javascript
// DOM fallback: nav profile link is always present
function detectViewerFromDom() {
  try {
    // IG nav always has a link to the logged-in user's profile
    const navLinks = document.querySelectorAll('nav a[href], header a[href]');
    for (const link of navLinks) {
      const href = link.getAttribute('href');
      if (href && /^\/[a-zA-Z0-9._]{1,30}\/$/.test(href)) {
        const handle = href.replace(/\//g, '');
        if (handle && handle !== 'explore' && handle !== 'direct') {
          window.dispatchEvent(new CustomEvent('ig-viewer', { detail: { username: handle } }));
          return;
        }
      }
    }
  } catch {}
}
// Run on DOM ready and after each fetch completes
if (document.readyState === 'complete') detectViewerFromDom();
else document.addEventListener('DOMContentLoaded', detectViewerFromDom);
```

---

## FIX 2: Account Detection in instagram.js + background.js
**Problem:** `instagram.js` doesn't listen for `ig-viewer` events. `background.js` has no storage for active account.

**Fix in instagram.js:** Add listener after existing `ig-action` listener:
```javascript
window.addEventListener('ig-viewer', (e) => {
  chrome.runtime.sendMessage({ type: 'IG_VIEWER', handle: e.detail.username });
});
```

Also call viewer detection whenever URL changes — add to `checkPage()`:
```javascript
function checkActiveAccount() {
  // Re-dispatch in case DOM changed after SPA navigation
  if (window.dispatchEvent) {
    setTimeout(() => {
      const evt = new Event('ig-viewer-check');
      window.dispatchEvent(evt);
    }, 1000);
  }
}
```
Call `checkActiveAccount()` at the top of `checkPage()`.

**Fix in background.js:** Add case to `handleMessage`:
```javascript
case 'IG_VIEWER': {
  const { handle } = msg;
  if (handle) {
    await chrome.storage.local.set({ activeIgAccount: handle });
  }
  return { ok: true };
}
```

---

## FIX 3: FanBasis Handle Setting in sidepanel.js + sidepanel.html
**Problem:** Settings panel has no `fanbasisHandle` field.

**Fix in sidepanel.html:** In the settings overlay form, add after the igSecret input:
```html
<div class="field-group">
  <label class="field-label">FanBasis IG Account</label>
  <input id="input-fanbasis" class="field-input" placeholder="@fanbasisig (no @)" />
</div>
```

**Fix in sidepanel.js:**
- In `settings-btn` handler: load and populate `fanbasisHandle` from `chrome.storage.sync`
- In `settings-save-btn` handler: include `fanbasisHandle: document.getElementById('input-fanbasis').value.trim().replace('@','')`

---

## FIX 4: Account Indicator Pill in sidepanel header
**Problem:** No visual indicator of which account is active.

**Fix in sidepanel.html:** In `#header`, replace or augment header-right:
```html
<div id="account-pill" class="account-pill hidden">
  <span class="account-dot"></span>
  <span id="account-label">@...</span>
</div>
```

**Fix in styles.css:** Add:
```css
.account-pill {
  display: flex; align-items: center; gap: 5px;
  font-size: 10px; padding: 2px 7px; border-radius: 10px;
  border: 1px solid var(--border);
}
.account-pill.correct { border-color: #22c55e44; background: #22c55e0d; color: #4ade80; }
.account-pill.wrong   { border-color: #f59e0b44; background: #f59e0b0d; color: #fbbf24; cursor: pointer; }
.account-dot { width: 6px; height: 6px; border-radius: 50%; background: currentColor; }
```

**Fix in sidepanel.js:** Add `updateAccountPill()` function called on init and `chrome.storage.onChanged`:
```javascript
async function updateAccountPill() {
  const { activeIgAccount = '' } = await chrome.storage.local.get({ activeIgAccount: '' });
  const { fanbasisHandle = '' } = await chrome.storage.sync.get({ fanbasisHandle: '' });
  const pill = document.getElementById('account-pill');
  const label = document.getElementById('account-label');
  if (!activeIgAccount) { pill.classList.add('hidden'); return; }
  pill.classList.remove('hidden');
  label.textContent = `@${activeIgAccount}`;
  const isCorrect = !fanbasisHandle || activeIgAccount.toLowerCase() === fanbasisHandle.toLowerCase();
  pill.classList.toggle('correct', isCorrect);
  pill.classList.toggle('wrong', !isCorrect);
  pill.title = isCorrect ? 'Correct account' : `Switch to @${fanbasisHandle}`;
  pill.onclick = isCorrect ? null : () => chrome.tabs.create({ url: 'https://www.instagram.com/accounts/login/' });
}
```
Call `updateAccountPill()` in init and add it to `chrome.storage.onChanged` listener.

---

## FIX 5: Wrong-Account Warning on /direct/ Pages
**Problem:** `instagram.js` runs `checkPendingForward()` on `/direct/` but no account check.

**Fix in instagram.js:** In the `/direct/` block at the bottom, add after `checkPendingForward()`:
```javascript
async function checkAccountMismatch() {
  const { activeIgAccount = '' } = await chrome.storage.local.get({ activeIgAccount: '' });
  const { fanbasisHandle = '' } = await chrome.storage.sync.get({ fanbasisHandle: '' });
  if (!fanbasisHandle || !activeIgAccount) return;
  if (activeIgAccount.toLowerCase() === fanbasisHandle.toLowerCase()) return;
  showAccountMismatchBanner(activeIgAccount, fanbasisHandle);
}

function showAccountMismatchBanner(currentHandle, fanbasisHandle) {
  const existing = document.getElementById('fb-account-banner');
  if (existing) return;
  const banner = document.createElement('div');
  banner.id = 'fb-account-banner';
  banner.style.cssText = [
    'position:fixed','top:0','left:0','right:0','z-index:2147483647',
    'background:#b45309','color:#fff','padding:8px 16px',
    'font-size:13px','font-weight:600','font-family:system-ui,sans-serif',
    'display:flex','align-items:center','justify-content:space-between',
    'box-shadow:0 2px 8px rgba(0,0,0,.4)'
  ].join(';');
  banner.innerHTML = `
    <span>⚠️ You're on @${currentHandle}. FanBasis outreach uses @${fanbasisHandle}.</span>
    <div style="display:flex;gap:8px">
      <a href="https://www.instagram.com/accounts/login/" target="_blank"
         style="background:rgba(255,255,255,.2);padding:3px 10px;border-radius:4px;color:#fff;text-decoration:none;font-size:12px">
        Switch account →
      </a>
      <button onclick="this.closest('#fb-account-banner').remove()"
              style="background:none;border:none;color:rgba(255,255,255,.7);cursor:pointer;font-size:16px;padding:0 4px">✕</button>
    </div>
  `;
  document.body.prepend(banner);
}
```
Add `checkAccountMismatch()` to the `/direct/` block.

---

## FIX 6: Extension Cache Sync from Dashboard
**Problem:** `sidepanel.js` only reads `chrome.storage.local` (extension's own copy). Dashboard changes never reach the extension.

**Fix in background.js:** Add a periodic alarm to sync leads:
```javascript
// Set up 5-minute sync alarm
chrome.runtime.onInstalled.addListener(() => {
  chrome.alarms.create('sync-leads', { periodInMinutes: 5 });
});

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (alarm.name === 'sync-leads') {
    await syncLeadsFromDashboard();
  }
  // ... existing fu: handler
});

async function syncLeadsFromDashboard() {
  try {
    const { dashboardUrl, igSecret } = await chrome.storage.sync.get({
      dashboardUrl: 'http://localhost:3000', igSecret: ''
    });
    const res = await fetch(`${dashboardUrl}/api/leads?mode=sales`, {
      headers: { 'x-ig-secret': igSecret }
    });
    if (!res.ok) return;
    const { leads: serverLeads } = await res.json();
    if (!Array.isArray(serverLeads)) return;

    // Merge server leads into local cache by ig_username
    const localLeads = await getLeads();
    const merged = [...localLeads];
    for (const sl of serverLeads) {
      if (!sl.ig_username) continue;
      const idx = merged.findIndex(l => l.igUsername === sl.ig_username);
      const mapped = {
        id: sl.id,
        igUsername: sl.ig_username,
        name: sl.name,
        stage: sl.stage,
        dueAt: sl.due_at ? new Date(sl.due_at).getTime() : null,
        followerCount: sl.follower_count ?? 0,
        fitScore: sl.research_cache?.fitScore ?? null,
        igOpener: sl.research_cache?.openers?.ig || sl.research_cache?.suggestedOpener || null,
        researchStatus: sl.research_status,
        source: sl.source,
        sfStatus: sl.sf_status || 'none',
      };
      if (idx >= 0) {
        merged[idx] = { ...merged[idx], ...mapped };
      } else {
        merged.push({ ...mapped, igProfileUrl: sl.ig_profile_url, bio: sl.bio || '', igEvents: sl.ig_events || [], createdAt: Date.now(), updatedAt: Date.now() });
      }
    }
    await saveLeads(merged);
  } catch (err) {
    console.error('[bg] sync failed:', err);
  }
}
```

Also call `syncLeadsFromDashboard()` in the `IG_PROFILE_SAVE` handler after saving locally.

Also trigger sync when sidepanel opens:
```javascript
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'SIDEPANEL_OPENED') {
    syncLeadsFromDashboard().then(() => sendResponse({ ok: true }));
    return true;
  }
  // ... existing handler
});
```

In `sidepanel.js`, on init send `chrome.runtime.sendMessage({ type: 'SIDEPANEL_OPENED' })`.

---

## FIX 7: Research Data on Lead Cards
**Problem:** Lead cards in sidepanel show only username, stage, due date. No fit score, no opener, no follower count.

**Fix in sidepanel.js:** Update the lead card template in `loadLeads()`:
```javascript
// In the active.map() template:
const fitScore = l.fitScore ?? null;
const fitColor = fitScore !== null ? (fitScore >= 75 ? '#22c55e' : fitScore >= 50 ? '#f59e0b' : '#ef4444') : null;
const opener = l.igOpener ? l.igOpener.slice(0, 80) + (l.igOpener.length > 80 ? '…' : '') : null;
const followers = l.followerCount 
  ? (l.followerCount >= 1e6 ? `${(l.followerCount/1e6).toFixed(1)}M` 
   : l.followerCount >= 1e3 ? `${Math.round(l.followerCount/1e3)}K` 
   : String(l.followerCount))
  : null;
```

In the lead-row HTML, after `lead-main`, add:
```html
<div class="lead-meta">
  ${followers ? `<span class="lead-followers">${followers}</span>` : ''}
  ${fitScore !== null ? `<span class="lead-fit" style="color:${fitColor}">${fitScore}</span>` : 
    l.researchStatus === 'pending' ? '<span class="lead-researching">●</span>' : ''}
</div>
${opener ? `<div class="lead-opener">${opener}</div>` : ''}
```

Add styles in `styles.css`:
```css
.lead-meta { display: flex; align-items: center; gap: 6px; margin-bottom: 3px; }
.lead-followers { font-size: 10px; color: var(--muted); }
.lead-fit { font-size: 11px; font-weight: 700; }
.lead-researching { font-size: 8px; color: #f59e0b; animation: pulse 1.5s infinite; }
.lead-opener { font-size: 11px; color: var(--muted); font-style: italic; margin-bottom: 5px; line-height: 1.4; }
@keyframes pulse { 0%,100%{opacity:1} 50%{opacity:.3} }
```

Also add a "Copy Opener" button on each card:
```html
${l.igOpener ? `<button class="copy-opener-btn" data-opener="${encodeURIComponent(l.igOpener)}">Copy opener</button>` : ''}
```
Wire it in loadLeads: `el.querySelectorAll('.copy-opener-btn').forEach(btn => btn.addEventListener('click', (e) => { e.stopPropagation(); copyText(decodeURIComponent(btn.dataset.opener), btn); }));`

---

## FIX 8: Stage Colors per Stage
**Problem:** `.stage-pill.active` in `styles.css` uses a single hardcoded blue for all stages.

**Fix in styles.css:** Replace the single `.stage-pill.active` rule with per-stage data attributes:
```css
/* Remove: .stage-pill.active { border-color: #3b82f6; background: rgba(59,130,246,.15); color: #93c5fd; } */
.stage-pill[data-active="true"] { opacity: 1; }
```

**Fix in sidepanel.js:** In the stage-pills template, replace `${s === l.stage ? "active" : ""}` with stage-specific inline styles:
```javascript
const STAGE_COLORS = {
  New:'#64748b', Warming:'#f59e0b', 'DM Sent':'#3b82f6', Replied:'#8b5cf6',
  Qualifying:'#06b6d4', 'Call Offered':'#10b981', Booked:'#22c55e',
  Closed:'#475569', DQ:'#ef4444', Active:'#22c55e', 'At Risk':'#f59e0b', Churned:'#6b7280'
};
// In the pill HTML:
const isActive = s === l.stage;
const color = STAGE_COLORS[s] || '#64748b';
const style = isActive 
  ? `border-color:${color};background:${color}22;color:${color}` 
  : '';
// pill: `<button class="stage-pill" data-id="${l.id}" data-stage="${s}" style="${style}">${s}</button>`
```

---

## FIX 9: Double-Tap Confirm on "DM Sent" Pill
**Problem:** Tapping "DM Sent" pill instantly commits with no confirmation.

**Fix in sidepanel.js:** In the stage-pill click handler, add a guard for "DM Sent":
```javascript
el.querySelectorAll('.stage-pill').forEach((btn) => {
  btn.addEventListener('click', async () => {
    const targetStage = btn.dataset.stage;
    const leadId = btn.dataset.id;
    
    // Double-tap confirm for DM Sent
    if (targetStage === 'DM Sent' && btn.dataset.confirming !== '1') {
      btn.dataset.confirming = '1';
      const orig = btn.textContent;
      btn.textContent = 'Confirm?';
      btn.style.borderColor = '#f59e0b';
      btn.style.color = '#f59e0b';
      setTimeout(() => {
        if (btn.dataset.confirming) {
          delete btn.dataset.confirming;
          btn.textContent = orig;
          btn.style.borderColor = '';
          btn.style.color = '';
        }
      }, 3000);
      return;
    }
    delete btn.dataset.confirming;

    const { leads: all = [] } = await chrome.storage.local.get({ leads: [] });
    const idx = all.findIndex((l) => l.id === leadId);
    if (idx >= 0) { all[idx].stage = targetStage; all[idx].updatedAt = Date.now(); }
    await chrome.storage.local.set({ leads: all });
    loadLeads();
    chrome.runtime.sendMessage({ type: 'UPDATE_LEAD_STAGE', leadId, stage: targetStage });
  });
});
```

---

## FIX 10: Save ig_user_id via background.js
**Problem:** Background.js receives `userId` in `IG_PROFILE_SAVE` but never forwards it.

**Fix in background.js:** In `IG_PROFILE_SAVE` handler, add `userId` to the `postToDashboard` payload:
```javascript
await postToDashboard({
  type: 'IG_PROFILE_SAVE',
  username,
  userId: userId ?? '',   // ← was already there, confirm it's passed through
  pageUrl: pageUrl ?? null,
  bio: bio ?? '',
  followerCount: followerCount ?? 0,
  displayName: displayName || username,
  savedFromAccount: (await chrome.storage.local.get({ activeIgAccount: '' })).activeIgAccount || '',
});
```
The `savedFromAccount` field will be received by the dashboard (T5 handles saving it).

---

## FIX 11: Merge Scripts + Remove Duplicate Directory
**Problem:** `chrome-extension/ig-lead-tracker/scripts-data.js` has better/newer scripts (with CTA rules, brand voice). Root `ig-lead-tracker/scripts-data.js` has the old simpler format. They've diverged.

**Fix:** Copy the BETTER scripts from `chrome-extension/ig-lead-tracker/scripts-data.js` into `ig-lead-tracker/scripts-data.js` BEFORE deleting `chrome-extension/`. The chrome-extension version has more structure and proper CTA rules — use it.

The chrome-extension scripts use format: `{ "IG Openers": [...], "Warm — IG Engagement": [...], "Qualification": [...], ... }`
The root scripts use format: `{ openers: [...], followup: [...], qualification: [...], objection: [...], pitch: [...] }`

Adopt the chrome-extension format (it's more complete). Update `sidepanel.js`'s `renderScripts()` to handle the named-group format:
```javascript
function renderScripts(category) {
  const pool = category === 'all'
    ? Object.values(SCRIPTS).flat()
    : (SCRIPTS[category] || []);
  // ... rest stays same
}

// Update CATEGORY_LABELS to match new keys:
const CATEGORY_LABELS = {
  'IG Openers': 'IG Openers',
  'Warm — IG Engagement': 'Warm',
  'Qualification': 'Qualify',
  'Objection Handling': 'Objections',
  'Call / Close': 'Close',
};
```

After merging scripts and verifying extension loads correctly: `rm -rf chrome-extension/`

---

## VERIFICATION
```bash
# Extension loads without errors in chrome://extensions
# Sidepanel: account pill appears when on instagram.com
# Sidepanel: research data (fit score, opener) shows on lead cards
# Stage pills use per-stage colors
# "DM Sent" requires double-tap
# On instagram.com/direct/ with wrong account: amber banner appears
# After saving a lead, syncLeadsFromDashboard fires and refreshes cache
```

## COORDINATES WITH
- **T4**: Ensure `/api/leads?mode=sales` response includes `research_cache` with `openers` and `fitScore` fields (it already does)
- **T5**: `savedFromAccount` field in ig-events POST — T5 saves it to the DB
- **T2**: `UPDATE_LEAD_STAGE` message → background.js PATCH (already wired in today's earlier fix)
