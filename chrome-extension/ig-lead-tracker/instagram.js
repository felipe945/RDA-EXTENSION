// Content script on instagram.com
// 1. Bridges IG follow/like events to background (existing behavior)
// 2. Injects a floating FanBasis lead card on every profile page

(function () {

  // ── Part 1: page-interceptor bridge (follow / like detection) ─────────────

  const interceptorScript = document.createElement("script");
  interceptorScript.src = chrome.runtime.getURL("page-interceptor.js");
  interceptorScript.onload = () => interceptorScript.remove();
  (document.head || document.documentElement).appendChild(interceptorScript);

  const userCache = {};

  function extractUsernameFromUrl() {
    const m = window.location.pathname.match(/^\/([^/]+)\/?$/);
    if (!m) return null;
    const slug = m[1];
    const NON_PROFILES = new Set([
      "", "explore", "reels", "reel", "stories", "direct", "accounts",
      "p", "tv", "ar", "login", "challenge", "oauth", "about", "press",
      "blog", "jobs", "legal", "privacy", "cookie", "accessibility",
    ]);
    return NON_PROFILES.has(slug) ? null : slug;
  }

  function extractUserIdFromUrl() {
    const m = window.location.pathname.match(/\/(\d+)/);
    return m ? m[1] : null;
  }

  function observeProfileHeader() {
    const fromUrl = extractUsernameFromUrl();
    if (!fromUrl) return;
    // LRU: evict oldest when over 50 entries
    const keys = Object.keys(userCache);
    if (keys.length >= 50) delete userCache[keys[0]];
    userCache[fromUrl] = fromUrl;
    // og:title is "Real Name (@handle) • Instagram photos and videos" — most reliable name source
    const ogTitle = document.querySelector('meta[property="og:title"]')?.content || "";
    const ogMatch = ogTitle.match(/^(.+?)\s*\(@/);
    if (ogMatch && ogMatch[1].trim().toLowerCase() !== fromUrl.toLowerCase()) {
      userCache[`${fromUrl}:name`] = ogMatch[1].trim();
    }
  }

  document.addEventListener("ig_action", (e) => {
    const { type, userId, postUrl } = e.detail;
    const username = userCache[userId] || extractUsernameFromUrl() || userId || "unknown";
    chrome.runtime.sendMessage({
      type: type === "follow" ? "IG_FOLLOW" : "IG_LIKE",
      username,
      userId,
      pageUrl: postUrl || window.location.href,
    });
  });

  // Forward logged-in account detection from page-interceptor to background
  document.addEventListener("ig_viewer", (e) => {
    if (e.detail?.username) {
      chrome.runtime.sendMessage({ type: "IG_VIEWER", handle: e.detail.username }).catch(() => {});
    }
  });

  // ── Inbound reply relay (Contract R1 ig_reply → Contract R2 CROSS_PLATFORM_REPLY) ──

  const SEEN_REPLIES_KEY = "fb_seenReplies"; // { [threadId]: { itemId, ts } }
  const SEEN_REPLIES_MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000;

  // Lowercased ig_username set of tracked leads, used to skip noise from
  // random inbounds. null / empty = treat as not loaded and relay everything —
  // background's matcher drops non-leads anyway, so over-relaying is safe
  // while under-relaying (stale/failed fetch) would lose real replies.
  let trackedHandles = null;

  function refreshTrackedHandles() {
    try {
      chrome.runtime.sendMessage({ type: "GET_LEADS" }, (resp) => {
        if (chrome.runtime.lastError) return;
        const leads = resp?.leads;
        if (!Array.isArray(leads)) return;
        trackedHandles = new Set(
          leads.map(l => (l.ig_username || "").toLowerCase()).filter(Boolean)
        );
      });
    } catch { /* extension context gone — keep relay-all fallback */ }
  }
  refreshTrackedHandles();
  setInterval(refreshTrackedHandles, 5 * 60 * 1000);

  // Dedup must persist across service-worker restarts, so it lives in
  // chrome.storage.local (the background's in-memory seenNotifIds does not
  // survive). This only dedups within THIS browser; cross-rep duplicates are
  // handled server-side via itemId, which is why itemId/threadId are forwarded.
  async function handleIgReply(d) {
    // Skip untracked handles BEFORE marking seen, so a reply arriving just
    // before its lead is added isn't permanently suppressed.
    if (trackedHandles && trackedHandles.size > 0 && !trackedHandles.has(d.username)) return;

    const { [SEEN_REPLIES_KEY]: map = {} } =
      await chrome.storage.local.get({ [SEEN_REPLIES_KEY]: {} });
    if (map[d.threadId]?.itemId === d.itemId) return; // already relayed

    const now = Date.now();
    for (const [tid, entry] of Object.entries(map)) {
      if (!entry?.ts || now - entry.ts > SEEN_REPLIES_MAX_AGE_MS) delete map[tid];
    }
    map[d.threadId] = { itemId: d.itemId, ts: now };
    await chrome.storage.local.set({ [SEEN_REPLIES_KEY]: map });

    chrome.runtime.sendMessage({
      type: "CROSS_PLATFORM_REPLY",
      platform: "ig",
      detectedName: d.username,
      messagePreview: d.text || "",
      itemId: d.itemId,     // idempotency key for server-side cross-rep dedup
      threadId: d.threadId, // idempotency key for server-side cross-rep dedup
    }).catch(() => {});
  }

  // Serialize handling so a fast burst of events can't interleave the
  // read-check-write against storage and double-relay the same item.
  let replyChain = Promise.resolve();
  document.addEventListener("ig_reply", (e) => {
    const d = e.detail || {};
    if (!d.username || !d.itemId || !d.threadId) return; // malformed → drop
    replyChain = replyChain.then(() => handleIgReply(d)).catch(() => {});
  });

  // ── Part 2: Floating lead card ─────────────────────────────────────────────

  const STAGES = ["New", "Warming", "DM Sent", "Replied", "Qualifying", "Call Offered", "Booked", "Closed", "DQ", "Active", "Churned"];

  let pollTimer = null;
  let dismissedFor = null;
  let cardPos = { top: null, left: null };

  // Only one DM-send watch may be live at a time — a stale watch from an
  // abandoned send must never auto-commit a later, unrelated ig_dm_sent.
  // (Human attestation via "✓ I sent it" is unaffected by cancellation.)
  let activeSendWatchCancel = null;

  const FB_PENDING_KEY = "fb_pendingDm";

  function getPendingDm() {
    try { return JSON.parse(localStorage.getItem(FB_PENDING_KEY) || "null"); } catch { return null; }
  }

  function _writePending(data) {
    try { localStorage.setItem(FB_PENDING_KEY, JSON.stringify(data)); } catch {}
    // Layer C: mirror to chrome.storage.local so it survives cross-account page reloads
    chrome.storage.local.set({ fb_pendingDm_backup: data }).catch(() => {});
  }

  function setPendingDm(profile, channel) {
    _writePending({ profile, channel, ts: Date.now() });
  }

  function setPendingDmFull(profile, channel, extra) {
    _writePending({ profile, channel, ts: Date.now(), ...extra });
  }

  function clearPendingDm() {
    try { localStorage.removeItem(FB_PENDING_KEY); } catch {}
    chrome.storage.local.remove("fb_pendingDm_backup").catch(() => {});
  }

  // Scan visible elements for text match — avoids fragile role/aria selectors
  function findVisibleByText(pattern, root) {
    const scope = root || document;
    const els = scope.querySelectorAll("div,span,p,li,button,a,section,article");
    for (const el of els) {
      if (!el.offsetParent) continue;
      const rect = el.getBoundingClientRect();
      if (rect.height < 1) continue;
      // Only match leaf-ish nodes (no deep nesting of matched text repeated in parents)
      const ownText = (el.childNodes.length === 1 && el.childNodes[0].nodeType === 3)
        ? el.textContent || ""
        : el.textContent || "";
      if (pattern.test(ownText)) return el;
    }
    return null;
  }

  // Auto-clicks "Switch accounts" → picks the target account once the IG menu appears.
  // onPhaseChange(phase) is called on each transition so the UI can show live status.
  function watchSwitchMenu(targetUsername, onPhaseChange, onTimeout) {
    const clean = (targetUsername || "").replace(/^@/, "").toLowerCase();
    let phase = "wait_menu";
    let tries = 0;

    function setPhase(p) {
      phase = p;
      tries = 0;
      if (onPhaseChange) onPhaseChange(p);
    }

    function walkToClickable(el) {
      let btn = el;
      while (btn && btn !== document.body) {
        const tag = btn.tagName.toLowerCase();
        const role = (btn.getAttribute("role") || "").toLowerCase();
        if (tag === "button" || tag === "a" || role === "button" || role === "menuitem" || role === "option" || role === "listitem") break;
        btn = btn.parentElement;
      }
      return btn || el;
    }

    const timer = setInterval(() => {
      if (++tries > 400) { clearInterval(timer); if (onTimeout) onTimeout(); return; } // ~60s max

      if (phase === "wait_menu") {
        // ONLY advance when "Switch accounts" text is actually visible.
        // Do NOT use [role="presentation"] — IG applies that to every image element,
        // causing an instant false-positive on any profile page.
        const switchText = findVisibleByText(/switch.?accounts?/i);
        if (switchText) setPhase("switch_accounts");
        return;
      }

      if (phase === "switch_accounts") {
        const el = findVisibleByText(/switch.?accounts?/i);
        if (el) {
          walkToClickable(el).click();
          setPhase("pick_account");
        } else {
          // "Switch accounts" text gone — menu closed mid-flow, reset to wait for it again
          setPhase("wait_menu");
        }
        return;
      }

      if (phase === "pick_account") {
        if (!clean) { clearInterval(timer); return; }
        // IG's account switcher shows display names AND handles — use .includes() on both.
        // findVisibleByText() with a strict regex misses display names like "Felipe Guimaraes".
        const dialog = document.querySelector('[role="dialog"],[role="alertdialog"]');
        const scope = dialog || document;
        const candidates = scope.querySelectorAll(
          "button,a,[role='option'],[role='button'],[role='listitem'],div[tabindex='0'],div[tabindex='-1']"
        );
        for (const node of candidates) {
          if (!node.offsetParent) continue;
          if (node.getBoundingClientRect().height < 4) continue;
          if (!(node.textContent || "").toLowerCase().includes(clean)) continue;
          walkToClickable(node).click();
          if (onPhaseChange) onPhaseChange("done");
          clearInterval(timer);
          return;
        }
      }
    }, 150);

    return () => clearInterval(timer);
  }

  async function getSettings() {
    // Bootstrap (cached by background after sign-in) wins over legacy storage.sync
    const [sync, local] = await Promise.all([
      new Promise((r) => chrome.storage.sync.get({
        dashboardUrl: "https://unified-sales-ops.vercel.app",
        igSecret: "",
        calendarUrl: "",
        personalIgUsername: "felipeguimars",
        fanbasisHandle: "fanbasis",
      }, r)),
      new Promise((r) => chrome.storage.local.get({ fb_bootstrap: null, fb_rep_token: null }, r)),
    ]);
    const boot = local.fb_bootstrap;
    return {
      dashboardUrl: boot?.dashboardUrl || sync.dashboardUrl,
      igSecret: sync.igSecret,
      repToken: local.fb_rep_token || "",
      calendarUrl: sync.calendarUrl,
      personalIgUsername: boot?.rep?.personalIgUsername || sync.personalIgUsername,
      fanbasisHandle: boot?.fanbasisHandle || sync.fanbasisHandle,
    };
  }

  async function repAuthHeader() {
    const { fb_rep_token } = await new Promise((r) => chrome.storage.local.get({ fb_rep_token: null }, r));
    return fb_rep_token ? { Authorization: `Bearer ${fb_rep_token}` } : {};
  }

  // C4 — Bearer repToken is the identity on /api/ig-events; keep sending the
  // legacy x-ig-secret alongside it during the rollout.
  async function igEventsHeaders(igSecret) {
    return {
      "Content-Type": "application/json",
      ...(igSecret ? { "x-ig-secret": igSecret } : {}),
      ...(await repAuthHeader()),
    };
  }

  function detectCurrentIgAccountFromDom() {
    const SKIP = new Set([
      "explore","direct","reel","reels","stories","p","accounts","tv","ar",
      "login","challenge","home","inbox","notifications","create","audio",
      "directinbox","about","privacy","help","settings","your_activity",
    ]);
    const valid = h => h && !SKIP.has(h.toLowerCase()) && /^[a-zA-Z0-9._]{2,30}$/.test(h);

    // Strategy 1: window._sharedData (works on some IG layouts)
    try {
      const u = window._sharedData?.config?.viewer?.username;
      if (u && valid(u)) return u.toLowerCase();
    } catch {}

    // Strategy 2: aria-label="Profile" — IG consistently marks the current user's nav link with this
    const ariaProfile = document.querySelector(
      'a[aria-label="Profile"], a[aria-label="profile"],' +
      '[aria-label="Profile"] a[href], nav a[aria-label="Profile"]'
    );
    if (ariaProfile) {
      const href = ariaProfile.getAttribute("href") || "";
      const m = href.match(/^\/([a-zA-Z0-9._]{2,30})\/?$/);
      if (m && valid(m[1])) return m[1].toLowerCase();
    }

    // Strategy 3: nav/sidebar img alt text — IG sets alt to the username on the profile pic
    const navImgs = document.querySelectorAll(
      "nav img[alt], header img[alt], [role='navigation'] img[alt], aside img[alt]"
    );
    for (const img of navImgs) {
      const alt = (img.getAttribute("alt") || "").trim();
      if (valid(alt)) return alt.toLowerCase();
    }

    // Strategy 4: nav/header links with single-segment href
    const links = document.querySelectorAll("nav a[href], header a[href], [role='navigation'] a[href]");
    for (const a of links) {
      const m = (a.getAttribute("href") || "").match(/^\/([a-zA-Z0-9._]{2,30})\/?$/);
      if (m && valid(m[1])) return m[1].toLowerCase();
    }

    // Strategy 5: visible left-sidebar links (handles non-nav layouts)
    const sidebarLinks = document.querySelectorAll("a[href^='/']");
    for (const a of sidebarLinks) {
      if (!a.offsetParent) continue;
      const rect = a.getBoundingClientRect();
      if (rect.left > 300 || rect.width < 1) continue;
      const m = (a.getAttribute("href") || "").match(/^\/([a-zA-Z0-9._]{2,30})\/?$/);
      if (m && valid(m[1])) return m[1].toLowerCase();
    }
    return null;
  }

  // Contract B: activeIgAccount is written to chrome.storage.local together with
  // activeIgAccountTs (epoch ms). It may only be trusted while fresh — older than
  // ACCOUNT_MAX_AGE_MS means "unknown", never "assume FanBasis".
  const ACCOUNT_MAX_AGE_MS = 5 * 60 * 1000;

  function freshActiveIgAccount(handle, ts) {
    if (!handle || !ts) return "";
    if (Date.now() - ts > ACCOUNT_MAX_AGE_MS) return "";
    return String(handle).toLowerCase();
  }

  function autoTypeInIgDm(text) {
    let tries = 0;
    const iv = setInterval(() => {
      if (++tries > 40) { clearInterval(iv); return; }
      const ed = document.querySelector(
        '[aria-label="Message"][contenteditable],' +
        'div[role="textbox"][contenteditable],' +
        '[data-lexical-editor="true"]'
      );
      if (!ed) return;
      clearInterval(iv);
      ed.focus();
      // Select all existing content so we replace it
      const sel = window.getSelection();
      const rng = document.createRange();
      rng.selectNodeContents(ed);
      if (sel) { sel.removeAllRanges(); sel.addRange(rng); }
      // Paste via DataTransfer — Lexical handles this correctly and preserves
      // paragraph breaks (\n\n) as separate blocks instead of collapsing them.
      try {
        const dt = new DataTransfer();
        dt.setData("text/plain", text);
        ed.dispatchEvent(new ClipboardEvent("paste", {
          clipboardData: dt,
          bubbles: true,
          cancelable: true,
        }));
      } catch {
        document.execCommand("insertText", false, text);
      }
    }, 300);
  }

  async function fetchLead(username, dashboardUrl) {
    // Check background cache first — instant, no network
    try {
      const { fb_cache } = await new Promise(resolve =>
        chrome.storage.local.get({ fb_cache: null }, resolve)
      );
      if (fb_cache?.leads?.length) {
        const hit = fb_cache.leads.find(l =>
          (l.ig_username || "").toLowerCase() === username.toLowerCase()
        );
        if (hit) return hit;
      }
    } catch { /* storage unavailable */ }

    // Fall back to live API with a timeout so it never hangs forever
    try {
      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch(
        `${dashboardUrl}/api/leads?ig_username=${encodeURIComponent(username)}`,
        { signal: ctrl.signal, headers: { Accept: "application/json", ...(await repAuthHeader()) } }
      );
      clearTimeout(tid);
      if (!res.ok) return null;
      const { leads } = await res.json();
      return leads?.[0] ?? null;
    } catch {
      return null;
    }
  }

  function parseFollowerCount() {
    const allSpans = Array.from(document.querySelectorAll("span"));
    for (const span of allSpans) {
      const text = span.textContent?.trim() ?? "";
      if (/^[\d,.]+[kKmM]?\s*$/.test(text)) {
        const m = text.match(/([\d,.]+)\s*([kKmM]?)/);
        if (m) {
          let n = parseFloat(m[1].replace(/,/g, ""));
          if (m[2].toLowerCase() === "k") n *= 1000;
          if (m[2].toLowerCase() === "m") n *= 1000000;
          if (n > 100) return Math.round(n);
        }
      }
    }
    return 0;
  }

  function detectStack(bio) {
    const b = (bio || "").toLowerCase();
    const tags = [];
    if (/kajabi/.test(b)) tags.push("Kajabi");
    if (/teachable/.test(b)) tags.push("Teachable");
    if (/thinkific/.test(b)) tags.push("Thinkific");
    if (/clickfunnel/.test(b)) tags.push("ClickFunnels");
    if (/gohighlevel|go high level/.test(b)) tags.push("GoHighLevel");
    if (/stripe/.test(b)) tags.push("Stripe");
    if (/shopify/.test(b)) tags.push("Shopify");
    if (/whop\.com/.test(b)) tags.push("Whop");
    if (/fitness|workout|gym|bodybuilding|personal.?train/.test(b)) tags.push("Fitness");
    if (/\bagency\b|\bmarketing agency\b/.test(b)) tags.push("Agency");
    if (/\bcoach(ing)?\b/.test(b)) tags.push("Coach");
    return tags;
  }

  function quickSuggest(displayName, bio) {
    if (typeof SCRIPTS === "undefined") return null;
    const firstName = (displayName || "").split(/\s+/)[0] || null;
    const namePH = firstName || "[Name]";
    const stack = detectStack(bio);
    const isFitness = stack.includes("Fitness");
    const hasStack = stack.some(s => ["Kajabi","Teachable","Thinkific","Stripe","Shopify"].includes(s));
    const openers = SCRIPTS["IG — FanBasis Account"] || [];
    let idx = 3; // Default Cold
    if (isFitness) idx = 4;
    else if (hasStack) idx = 2;
    const s = openers[idx] || openers[0];
    if (!s) return null;
    return {
      label: s.label,
      text: s.text.replace(/\[Name\]/g, namePH).replace(/\[name\]/g, namePH.toLowerCase()),
      stack,
    };
  }

  function sendProfileContext(username, displayName, bio, followers, stack) {
    try {
      chrome.storage.local.set({
        _fbActiveProfile: {
          platform: "ig",
          username,
          displayName,
          bio: (bio || "").slice(0, 200),
          followers,
          stack,
          ts: Date.now(),
        },
      });
    } catch { /* storage unavailable */ }
  }

  function openIgDm(username) {
    let tries = 0;
    function attempt() {
      const btn = Array.from(
        document.querySelectorAll('[role="button"], button, div[tabindex="0"]')
      ).find(el =>
        el.textContent.trim() === "Message" ||
        el.getAttribute("aria-label") === "Message"
      );
      if (btn) {
        btn.click();
        return;
      }
      if (++tries < 6) {
        setTimeout(attempt, 400);
      } else {
        try { localStorage.setItem("fb_auto_dm_confirm", "1"); } catch {}
        window.location.href = `https://www.instagram.com/direct/new/?username=${encodeURIComponent(username)}`;
      }
    }
    attempt();
  }

  function queueRetry(payload, igSecret) {
    try {
      const q = JSON.parse(localStorage.getItem("fb_retry_queue") || "[]");
      q.push({ payload, igSecret, ts: Date.now() });
      localStorage.setItem("fb_retry_queue", JSON.stringify(q.slice(-20)));
    } catch { /* ignore */ }
  }

  async function flushRetryQueue(dashboardUrl) {
    try {
      const q = JSON.parse(localStorage.getItem("fb_retry_queue") || "[]");
      if (!q.length) return;
      const remaining = [];
      for (const item of q) {
        if (Date.now() - item.ts > 7 * 24 * 3600000) continue; // drop > 7 days
        try {
          const res = await fetch(`${dashboardUrl}/api/ig-events`, {
            method: "POST",
            headers: await igEventsHeaders(item.igSecret),
            body: JSON.stringify(item.payload),
          });
          if (!res.ok) remaining.push(item);
        } catch {
          remaining.push(item);
        }
      }
      localStorage.setItem("fb_retry_queue", JSON.stringify(remaining));
    } catch { /* ignore */ }
  }

  async function saveLead(username, dashboardUrl, igSecret) {
    const bio = document.querySelector('meta[name="description"]')?.content ?? "";
    const followerCount = parseFollowerCount();
    const displayName =
      document.querySelector("h1")?.textContent?.trim() ||
      document.querySelector("h2")?.textContent?.trim() ||
      username;

    const { activeIgAccount: savedFromAccount = "" } = await new Promise((r) =>
      chrome.storage.local.get({ activeIgAccount: "" }, r)
    );

    const payload = {
      type: "IG_PROFILE_SAVE",
      username,
      userId: "",
      pageUrl: window.location.href,
      bio,
      followerCount,
      displayName,
      savedFromAccount,
    };

    try {
      const res = await fetch(`${dashboardUrl}/api/ig-events`, {
        method: "POST",
        headers: await igEventsHeaders(igSecret),
        body: JSON.stringify(payload),
      });
      if (!res.ok) throw new Error(String(res.status));
      return await res.json();
    } catch (err) {
      queueRetry(payload, igSecret);
      throw err;
    }
  }

  function fitColor(score) {
    if (score >= 75) return "#22c55e";
    if (score >= 50) return "#f59e0b";
    return "#ef4444";
  }

  function fitLabel(score) {
    if (score >= 75) return "Strong Fit";
    if (score >= 50) return "Moderate";
    return "Weak Fit";
  }

  // ── Card lifecycle ──────────────────────────────────────────────────────────

  function removeCard() {
    document.getElementById("fb-tracker-card")?.remove();
    clearInterval(pollTimer);
    pollTimer = null;
  }

  function injectStyles() {
    if (document.getElementById("fb-card-styles")) return;
    const s = document.createElement("style");
    s.id = "fb-card-styles";
    s.textContent = `
      @keyframes fb-pulse { 0%,100%{opacity:1} 50%{opacity:.35} }
      @keyframes fb-in { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
      #fb-tracker-card *{box-sizing:border-box;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif}
      #fb-tracker-card select option{background:#111}
      #fb-tracker-card button:active{opacity:.7}
    `;
    document.head.appendChild(s);
  }

  function buildCard() {
    removeCard();
    // A fresh card means any in-flight send watch belongs to an abandoned flow.
    // (removeCard alone must NOT cancel — it also fires when navigating into the
    // DM thread, where the watch legitimately waits for ig_dm_sent.)
    if (activeSendWatchCancel) activeSendWatchCancel();
    injectStyles();

    const card = document.createElement("div");
    card.id = "fb-tracker-card";
    card.style.cssText = [
      "position:fixed", "z-index:2147483647",
      "width:290px", "background:#111", "border:1px solid #252525",
      "border-radius:12px", "color:#e5e5e5", "font-size:13px",
      "box-shadow:0 8px 32px rgba(0,0,0,.75),0 0 0 1px rgba(255,58,105,.12)",
      "animation:fb-in .18s ease-out", "overflow:hidden",
    ].join(";");
    if (cardPos.top !== null) {
      card.style.top = cardPos.top + "px";
      card.style.left = cardPos.left + "px";
    } else {
      card.style.bottom = "24px";
      card.style.right = "24px";
    }
    document.body.appendChild(card);
    return card;
  }

  function renderHeader(card, username) {
    const h = document.createElement("div");
    h.style.cssText = "background:#161616;padding:9px 14px;display:flex;flex-direction:column;gap:5px;border-bottom:1px solid #232323;cursor:grab;user-select:none";
    const topRow = document.createElement("div");
    topRow.style.cssText = "display:flex;align-items:center;justify-content:space-between";
    topRow.innerHTML = `
      <div style="display:flex;align-items:center;gap:6px">
        <span style="font-weight:700;color:#FF3A69;font-size:11px;letter-spacing:1px">FANBASIS</span>
        <span style="color:#333;font-size:12px">·</span>
        <span style="color:#666;font-size:11px">@${username}</span>
      </div>
      <div style="display:flex;align-items:center;gap:6px">
        <button id="fb-switch-search" style="background:none;border:none;color:#444;cursor:pointer;font-size:13px;padding:0;line-height:1" title="Go to profile">🔍</button>
        <button id="fb-close" style="background:none;border:none;color:#444;cursor:pointer;font-size:19px;padding:0;line-height:1" title="Dismiss">×</button>
      </div>
    `;
    h.appendChild(topRow);

    const searchRow = document.createElement("div");
    searchRow.id = "fb-search-row";
    searchRow.style.cssText = "display:none;gap:4px";
    const searchInput = document.createElement("input");
    searchInput.placeholder = "@handle or name…";
    searchInput.style.cssText = "flex:1;background:#0f0f12;border:1px solid #2a2a35;border-radius:6px;color:#ddd;font-size:11px;padding:4px 8px;outline:none";
    const goBtn = document.createElement("button");
    goBtn.textContent = "Go";
    goBtn.style.cssText = "background:#FF3A69;border:none;border-radius:6px;color:#fff;font-size:11px;font-weight:600;padding:4px 10px;cursor:pointer";
    searchRow.appendChild(searchInput);
    searchRow.appendChild(goBtn);
    h.appendChild(searchRow);
    card.appendChild(h);

    document.getElementById("fb-switch-search").addEventListener("click", (e) => {
      e.stopPropagation();
      searchRow.style.display = searchRow.style.display === "none" ? "flex" : "none";
      if (searchRow.style.display === "flex") searchInput.focus();
    });

    function navigateToHandle() {
      const val = searchInput.value.trim().replace(/^@/, "").replace(/\s+/g, "").toLowerCase();
      if (!val) return;
      // First check cache for a match
      chrome.runtime.sendMessage({ type: "GET_LEADS" }, (resp) => {
        const leads = resp?.leads || [];
        const match = leads.find(l =>
          (l.ig_username || "").toLowerCase() === val ||
          (l.name || "").toLowerCase().includes(val)
        );
        const handle = match?.ig_username || val;
        window.location.href = `https://www.instagram.com/${handle}/`;
      });
    }

    goBtn.addEventListener("click", navigateToHandle);
    searchInput.addEventListener("keydown", (e) => { if (e.key === "Enter") navigateToHandle(); });

    document.getElementById("fb-close").addEventListener("click", () => {
      dismissedFor = username;
      removeCard();
    });

    h.addEventListener("mousedown", (e) => {
      if (e.target.id === "fb-close") return;
      e.preventDefault();
      const rect = card.getBoundingClientRect();
      card.style.bottom = "";
      card.style.right = "";
      card.style.top = rect.top + "px";
      card.style.left = rect.left + "px";
      const ox = e.clientX - rect.left;
      const oy = e.clientY - rect.top;
      h.style.cursor = "grabbing";
      const onMove = (e) => {
        let nl = e.clientX - ox;
        let nt = e.clientY - oy;
        nl = Math.max(0, Math.min(nl, window.innerWidth - card.offsetWidth));
        nt = Math.max(0, Math.min(nt, window.innerHeight - card.offsetHeight));
        card.style.left = nl + "px";
        card.style.top = nt + "px";
      };
      const onUp = () => {
        h.style.cursor = "grab";
        cardPos.top = parseFloat(card.style.top);
        cardPos.left = parseFloat(card.style.left);
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
      };
      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onUp);
    });
  }

  // ── Auto-confirm Instagram's message request / partnerships dialog ─────────

  function autoConfirmIgDialog() {
    let tries = 0;
    const poll = setInterval(() => {
      if (++tries > 40) { clearInterval(poll); return; }
      const dlg = document.querySelector('[role="dialog"], [data-testid="modal-dialog"]');
      const scope = dlg || document;
      const allBtns = Array.from(scope.querySelectorAll('[role="button"], button'));
      const target = allBtns.find(el => {
        const t = (el.textContent || "").trim().toLowerCase();
        return (
          t === "send message request" || t === "send request" ||
          t === "next" || t === "done" || t === "send" ||
          t === "start chat" || t === "send dm" || t === "ok" ||
          t === "accept" || t === "confirm"
        );
      });
      if (target) { target.click(); clearInterval(poll); }
    }, 150);
  }

  // ── Account switch + auto-DM flow ──────────────────────────────────────────

  function renderSwitchPrompt(card, b, username, channel, lead, onSwitchComplete, crossChannelIntro) {
    Promise.all([
      getSettings(),
      new Promise(r => chrome.storage.local.get({ activeIgAccount: "", activeIgAccountTs: 0 }, r)),
    ]).then(([{ personalIgUsername, fanbasisHandle: fbH }, { activeIgAccount, activeIgAccountTs }]) => {
      const target = channel === "ig_personal"
        ? (personalIgUsername || "").replace(/^@/, "")
        : (fbH || "fanbasis").replace(/^@/, "");

      // Skip the switch only on a fresh account signal (Contract B) or live DOM
      // detection — a stale activeIgAccount must not be trusted to skip the prompt
      const currentAcct = (freshActiveIgAccount(activeIgAccount, activeIgAccountTs) || detectCurrentIgAccountFromDom() || "").toLowerCase();
      if (target && currentAcct === target.toLowerCase()) {
        clearPendingDm();
        if (onSwitchComplete) { onSwitchComplete(); return; }
        showDmPreview(card, b, username, null, { channel, lead, crossChannelIntro });
        return;
      }

      b.style.display = "none";
      const prompt = document.createElement("div");
      prompt.style.cssText = "padding:12px 14px";
      card.appendChild(prompt);

      if (onSwitchComplete && lead?.id) {
        getSettings().then(({ dashboardUrl: dUrl }) => {
          setPendingDmFull(username, channel, {
            secondTouch: { leadId: lead.id, dashboardUrl: dUrl },
            crossChannelIntro: crossChannelIntro || null,
          });
        });
      } else {
        setPendingDm(username, channel);
      }

      const targetLabel = target ? `@${target}` : "your other account";

      prompt.innerHTML = `
        <div style="font-size:11px;font-weight:700;color:#e5e5e5;margin-bottom:8px">Switch to ${targetLabel}</div>
        <div style="background:#0a0a10;border:1px solid #1e1e2a;border-radius:7px;padding:8px 10px;margin-bottom:8px">
          <div style="display:flex;align-items:baseline;gap:7px;margin-bottom:4px">
            <span style="background:#FF3A69;color:#fff;font-size:8px;font-weight:700;border-radius:50%;min-width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">1</span>
            <span style="font-size:11px;color:#94a3b8">In Instagram, click <strong style="color:#e5e5e5">≡ More</strong> at the bottom of the left sidebar</span>
          </div>
          <div style="display:flex;align-items:baseline;gap:7px;margin-bottom:4px">
            <span style="background:#FF3A69;color:#fff;font-size:8px;font-weight:700;border-radius:50%;min-width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">2</span>
            <span style="font-size:11px;color:#94a3b8">Select <strong style="color:#e5e5e5">Switch accounts</strong></span>
          </div>
          <div style="display:flex;align-items:baseline;gap:7px">
            <span style="background:#FF3A69;color:#fff;font-size:8px;font-weight:700;border-radius:50%;min-width:14px;height:14px;display:inline-flex;align-items:center;justify-content:center;flex-shrink:0">3</span>
            <span style="font-size:11px;color:#94a3b8">Choose <strong style="color:#e5e5e5">${targetLabel}</strong> — page reloads, DM flow continues automatically</span>
          </div>
        </div>
        <div id="fb-switch-status" style="font-size:10px;color:#3b82f6;background:#0f172a;border:1px solid #1e3a5f;border-radius:6px;padding:6px 8px;margin-bottom:8px;display:none">
        </div>
      `;

      const statusEl = prompt.querySelector("#fb-switch-status");

      // Layer A: live phase label — updates as watchSwitchMenu progresses
      function onPhaseChange(p) {
        if (!statusEl) return;
        const labels = {
          switch_accounts: "⟳ Menu open — clicking Switch accounts…",
          pick_account:    `⟳ Picking ${targetLabel}…`,
          done:            `✓ Switched to ${targetLabel} — page will reload`,
        };
        const color = p === "done" ? "#22c55e" : "#3b82f6";
        const bg    = p === "done" ? "#0d2b0d" : "#0f172a";
        const border= p === "done" ? "#166534" : "#1e3a5f";
        statusEl.style.color = color;
        statusEl.style.background = bg;
        statusEl.style.borderColor = border;
        statusEl.textContent = labels[p] || "⟳ Watching…";
        statusEl.style.display = "block";
      }

      const cancelWatch = watchSwitchMenu(target, onPhaseChange, cleanup);

      // Layer B: storage watcher fallback — catches manual account switches too.
      // If the user manually clicks through the IG UI (or auto-click is slow),
      // detect the account change via activeIgAccount and complete the flow.
      let storageCleanedUp = false;
      function cleanup() {
        if (storageCleanedUp) return;
        storageCleanedUp = true;
        cancelWatch();
        chrome.storage.onChanged.removeListener(storageWatcher);
      }

      function storageWatcher(changes) {
        if (!changes.activeIgAccount) return;
        const newAcct = (changes.activeIgAccount.newValue || "").toLowerCase();
        if (!target || newAcct !== target.toLowerCase()) return;
        // Account switched to the target — complete the flow
        cleanup();
        clearPendingDm();
        if (statusEl) {
          statusEl.style.color = "#22c55e";
          statusEl.style.background = "#0d2b0d";
          statusEl.style.borderColor = "#166534";
          statusEl.textContent = `✓ Switched to ${targetLabel} — loading profile…`;
        }
        setTimeout(() => {
          prompt.remove();
          b.style.display = "";
          if (onSwitchComplete) onSwitchComplete();
          else showDmPreview(card, b, username, null, { channel, lead, crossChannelIntro });
        }, 400);
      }

      chrome.storage.onChanged.addListener(storageWatcher);

      // "I've Switched" — validates account then continues
      const doneBtn = document.createElement("button");
      doneBtn.textContent = "✓ I've Switched — Continue";
      doneBtn.style.cssText = "width:100%;background:#0f2540;border:1px solid #22c55e;border-radius:8px;color:#4ade80;font-size:11px;font-weight:600;padding:9px;cursor:pointer;margin-bottom:6px";
      doneBtn.addEventListener("click", () => {
        doneBtn.disabled = true;
        doneBtn.textContent = "Checking account…";
        // Kick fresh DOM detection, then read what storage has
        document.dispatchEvent(new CustomEvent("ig_viewer_check", { bubbles: true, composed: true }));
        setTimeout(() => {
          chrome.storage.local.get({ activeIgAccount: "", activeIgAccountTs: 0 }, ({ activeIgAccount, activeIgAccountTs }) => {
            const detected = (freshActiveIgAccount(activeIgAccount, activeIgAccountTs) || detectCurrentIgAccountFromDom() || "").toLowerCase();
            if (!target || detected === target.toLowerCase()) {
              cleanup();
              clearPendingDm();
              prompt.remove();
              b.style.display = "";
              if (onSwitchComplete) onSwitchComplete();
              else showDmPreview(card, b, username, null, { channel, lead, crossChannelIntro });
            } else {
              doneBtn.textContent = `Still on @${detected || "??"} — switch first`;
              doneBtn.style.background = "#1a0000";
              doneBtn.style.borderColor = "#ef4444";
              doneBtn.style.color = "#ef4444";
              setTimeout(() => {
                doneBtn.textContent = "✓ I've Switched — Continue";
                doneBtn.style.background = "#0f2540";
                doneBtn.style.borderColor = "#22c55e";
                doneBtn.style.color = "#4ade80";
                doneBtn.disabled = false;
              }, 2500);
            }
          });
        }, 350);
      });
      prompt.appendChild(doneBtn);

      const btnRow = document.createElement("div");
      btnRow.style.cssText = "display:flex;gap:6px";

      const sendNowBtn = document.createElement("button");
      // Label the account this will actually send from — never imply the target
      sendNowBtn.textContent = currentAcct ? `Skip — send as @${currentAcct}` : "Skip — send from unknown account";
      sendNowBtn.style.cssText = "flex:1;background:#161616;border:1px solid #252525;border-radius:8px;color:#555;font-size:10px;font-weight:600;padding:7px 4px;cursor:pointer";
      sendNowBtn.addEventListener("click", () => {
        cleanup();
        clearPendingDm();
        prompt.remove();
        b.style.display = "";
        if (onSwitchComplete) { onSwitchComplete(); return; }
        showDmPreview(card, b, username, null, { channel, lead, crossChannelIntro });
      });

      const cancelBtn = document.createElement("button");
      cancelBtn.textContent = "✕";
      cancelBtn.style.cssText = "background:#161616;border:1px solid #252525;border-radius:8px;color:#555;font-size:13px;font-weight:600;padding:7px 10px;cursor:pointer;flex-shrink:0";
      cancelBtn.addEventListener("click", () => {
        cleanup();
        clearPendingDm();
        prompt.remove();
        b.style.display = "";
      });

      btnRow.appendChild(sendNowBtn);
      btnRow.appendChild(cancelBtn);
      prompt.appendChild(btnRow);
    });
  }

  // ── Channel tracking helpers ────────────────────────────────────────────────

  function chTime(ts) {
    const d = Date.now() - ts;
    if (d < 3600000) return "now";
    if (d < 86400000) return Math.floor(d / 3600000) + "h ago";
    return Math.floor(d / 86400000) + "d ago";
  }

  async function markChannelSent(leadId, channel, current, dashboardUrl) {
    const updated = { ...(current || {}), [channel]: { sent: true, sentAt: Date.now() } };
    try {
      await fetch(`${dashboardUrl}/api/leads`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...(await repAuthHeader()) },
        body: JSON.stringify({ id: leadId, outreach_channels: updated }),
      });
    } catch { /* ignore */ }
  }

  const CH_DEFS = [
    { k: "ig_fanbasis", icon: "📸", label: "FanBasis" },
    { k: "ig_personal", icon: "📸", label: "Personal" },
    { k: "linkedin",    icon: "💼", label: "LinkedIn" },
    { k: "email",       icon: "✉️", label: "Email" },
  ];

  function renderChannelTracker(container, channels) {
    const chs = channels || {};
    const row = document.createElement("div");
    row.id = "fb-ch-tracker";
    row.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;margin-bottom:8px";
    for (const d of CH_DEFS) {
      const info = chs[d.k];
      const pill = document.createElement("div");
      pill.setAttribute("data-ch", d.k);
      if (info?.sentAt) {
        pill.style.cssText = "font-size:10px;padding:2px 7px;border-radius:6px;background:#0d2b0d;border:1px solid #166534;color:#4ade80;white-space:nowrap";
        pill.textContent = d.icon + " " + d.label + " ✓ " + chTime(info.sentAt);
      } else {
        pill.style.cssText = "font-size:10px;padding:2px 7px;border-radius:6px;background:#111;border:1px solid #252525;color:#3a3a3a;white-space:nowrap";
        pill.textContent = d.icon + " " + d.label;
      }
      row.appendChild(pill);
    }
    container.appendChild(row);
    return row;
  }

  function markPillSent(card, channel) {
    const pill = card.querySelector(`[data-ch="${channel}"]`);
    if (!pill) return;
    const def = CH_DEFS.find(d => d.k === channel);
    if (!def) return;
    pill.style.cssText = "font-size:10px;padding:2px 7px;border-radius:6px;background:#0d2b0d;border:1px solid #166534;color:#4ade80;white-space:nowrap";
    pill.textContent = def.icon + " " + def.label + " ✓ now";
  }

  // ── Stage-aware script list ────────────────────────────────────────────────

  function buildScriptList(lead, displayName, bio, aiOpener) {
    const stage = lead?.stage || "New";
    const firstName = (displayName || "").split(/\s+/)[0] || null;
    const fn = firstName || "[Name]";

    function fill(t) {
      return (t || "")
        .replace(/\[Name\]/g, fn)
        .replace(/\[name\]/g, fn.toLowerCase());
    }

    let pool = [];
    if (typeof SCRIPTS !== "undefined") {
      if (["New", "Warming"].includes(stage)) {
        pool = [...(SCRIPTS["IG — FanBasis Account"] || []), ...(SCRIPTS["IG — Personal Account"] || [])];
      } else if (stage === "DM Sent") {
        pool = [...(SCRIPTS["Cross-Channel & Follow-Ups"] || []), ...(SCRIPTS["IG — FanBasis Account"] || [])];
      } else if (stage === "Replied") {
        pool = [...(SCRIPTS["Qualification"] || []), ...(SCRIPTS["Objections"] || [])];
      } else if (["Qualifying", "Call Offered"].includes(stage)) {
        pool = [...(SCRIPTS["Pitch & Book"] || []), ...(SCRIPTS["Objections"] || [])];
      } else {
        pool = [...(SCRIPTS["IG — FanBasis Account"] || [])];
      }
    }

    let scripts = pool.map(s => ({ label: s.label, text: fill(s.text) }));

    if (["New", "Warming"].includes(stage) && !aiOpener) {
      const stack = detectStack(bio);
      const idx = stack.includes("Fitness")
        ? scripts.findIndex(s => s.label.toLowerCase().includes("fitness"))
        : stack.some(t => ["Kajabi","Teachable","Thinkific","Stripe","Shopify"].includes(t))
          ? scripts.findIndex(s => s.label.toLowerCase().includes("stack"))
          : -1;
      if (idx > 0) {
        const [pref] = scripts.splice(idx, 1);
        scripts.unshift(pref);
      }
    }

    if (aiOpener) {
      scripts = [{ label: "✨ AI Researched", text: fill(aiOpener) }, ...scripts];
    }

    if (!scripts.length) {
      scripts = [{ label: "Default", text: fill(`Hey ${fn} — on the partnerships team at FanBasis.\n\nWe work with high-ticket creators through lower fees, BNPL at checkout, and a lead qualifier that screens buyers before they get on a call.\n\nHappy to find time this week if it makes sense.`) }];
    }

    return scripts;
  }

  // ── Calendar slot helpers ──────────────────────────────────────────────────

  function calFormatSlot(isoStart) {
    const d = new Date(isoStart);
    const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const h = d.getHours(); const m = d.getMinutes();
    const h12 = h % 12 || 12; const ampm = h >= 12 ? "pm" : "am";
    const minStr = m === 0 ? "" : `:${String(m).padStart(2,"0")}`;
    return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()} · ${h12}${minStr}${ampm}`;
  }

  function calFormatSlotsForDm(isoStarts) {
    function fmtShort(iso) {
      const dt = new Date(iso);
      const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
      const h = dt.getHours(); const m = dt.getMinutes();
      const h12 = h % 12 || 12; const ampm = h >= 12 ? "pm" : "am";
      const minStr = m === 0 ? "" : `:${String(m).padStart(2,"0")}`;
      return `${days[dt.getDay()]} at ${h12}${minStr}${ampm}`;
    }
    if (!isoStarts.length) return "";
    const texts = isoStarts.map(fmtShort);
    if (texts.length === 1) return texts[0];
    if (texts.length === 2) return `${texts[0]} or ${texts[1]}`;
    const last = texts.pop();
    return texts.join(", ") + ", or " + last;
  }

  // ── Slot picker (Google Calendar integration) ──────────────────────────────

  function showSlotPicker(card, b, username, lead, dashboardUrl, slots, slotMins) {
    b.style.display = "none";
    slotMins = slotMins || 45;

    const picker = document.createElement("div");
    picker.style.cssText = "padding:12px 14px";

    // Header
    const hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:10px";
    const leadDisplayName = lead?.name || (lead?.ig_username ? `@${lead.ig_username}` : username);
    hdr.innerHTML = `
      <span style="width:7px;height:7px;border-radius:50%;background:#4285F4;display:inline-block;flex-shrink:0"></span>
      <span style="font-size:10px;font-weight:700;color:#93c5fd;letter-spacing:.04em">${slotMins}-min slots for <span style="color:#e2e8f0">${leadDisplayName}</span></span>
    `;
    picker.appendChild(hdr);

    // Slot list — pre-select first 3
    const selected = new Set(slots.slice(0, 3).map(s => s.start));
    const listEl = document.createElement("div");
    listEl.style.cssText = "display:flex;flex-direction:column;gap:4px;margin-bottom:10px";

    slots.forEach(slot => {
      const row = document.createElement("div");
      const isSelected = selected.has(slot.start);
      row.style.cssText = `display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:6px;cursor:pointer;background:${isSelected ? "#0e1e38" : "#111118"};border:1px solid ${isSelected ? "#1d4ed8" : "#1e1e2e"}`;
      row.innerHTML = `
        <span class="slot-cb" style="width:13px;height:13px;border-radius:3px;border:1px solid ${isSelected ? "#4285F4" : "#2a2a3a"};background:${isSelected ? "#4285F4" : "transparent"};display:flex;align-items:center;justify-content:center;flex-shrink:0;font-size:9px;color:#fff">${isSelected ? "✓" : ""}</span>
        <span style="font-size:11px;color:${isSelected ? "#e2e8f0" : "#6e7280"};font-variant-numeric:tabular-nums">${calFormatSlot(slot.start)}</span>
      `;
      row.addEventListener("click", () => {
        if (selected.has(slot.start)) {
          selected.delete(slot.start);
          row.style.background = "#111118";
          row.style.borderColor = "#1e1e2e";
          row.querySelector(".slot-cb").style.background = "transparent";
          row.querySelector(".slot-cb").style.borderColor = "#2a2a3a";
          row.querySelector(".slot-cb").textContent = "";
        } else {
          if (selected.size >= 3) return;
          selected.add(slot.start);
          row.style.background = "#0e1e38";
          row.style.borderColor = "#1d4ed8";
          row.querySelector(".slot-cb").style.background = "#4285F4";
          row.querySelector(".slot-cb").style.borderColor = "#4285F4";
          row.querySelector(".slot-cb").textContent = "✓";
        }
      });
      listEl.appendChild(row);
    });
    picker.appendChild(listEl);

    // Hint
    const hint = document.createElement("div");
    hint.style.cssText = "font-size:9px;color:#444;margin-bottom:8px;text-align:center";
    hint.textContent = "Select up to 3 slots";
    picker.appendChild(hint);

    // Button row
    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:6px";
    const backBtn = document.createElement("button");
    backBtn.textContent = "← Back";
    backBtn.style.cssText = "flex:1;background:#161616;border:1px solid #252525;border-radius:7px;color:#94a3b8;font-size:11px;font-weight:600;padding:8px;cursor:pointer";
    backBtn.addEventListener("click", () => { picker.remove(); b.style.display = ""; });

    const insertBtn = document.createElement("button");
    insertBtn.textContent = "Insert into DM →";
    insertBtn.style.cssText = "flex:2;background:#0f2540;border:1px solid #1d4ed8;border-radius:7px;color:#93c5fd;font-size:11px;font-weight:600;padding:8px;cursor:pointer";
    insertBtn.addEventListener("click", () => {
      const chosen = [...selected];
      if (!chosen.length) return;
      const slotText = calFormatSlotsForDm(chosen);
      const og = document.querySelector('meta[property="og:title"]')?.content || "";
      const m = og.match(/^(.+?)\s*\(@/);
      const firstName = (m ? m[1].trim() : "").split(" ")[0] || username;
      const dmText = `Hey ${firstName} — happy to walk through the dashboard, no pitch, just ${slotMins} min to show you what it looks like with your numbers.\n\nI'm open ${slotText} — any of those work?`;
      picker.remove();
      b.style.display = "";
      showDmPreview(card, b, username, null, {
        lead,
        leadId: lead.id,
        channel: "ig_fanbasis",
        dashboardUrl,
        bookingScript: dmText,
        afterSend: () => {
          chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { stage: "Call Offered" } }).catch(() => {});
          setTimeout(() => updateCardForProfile(), 500);
        },
      });
    });

    const bookEventBtn = document.createElement("button");
    bookEventBtn.textContent = "📅 Book";
    bookEventBtn.title = "Create Google Calendar event";
    bookEventBtn.style.cssText = "flex:1;background:#0d2b18;border:1px solid #166534;border-radius:7px;color:#4ade80;font-size:11px;font-weight:600;padding:8px;cursor:pointer";
    bookEventBtn.addEventListener("click", () => {
      const chosen = [...selected];
      if (!chosen.length) return;
      btnRow.style.display = "none";

      const iStyle = "background:#0a1f10;border:1px solid #166534;border-radius:6px;color:#d1fae5;font-size:11px;padding:7px 9px;outline:none;width:100%;box-sizing:border-box";
      const form = document.createElement("div");
      form.style.cssText = "display:flex;flex-direction:column;gap:7px;margin-top:8px";

      const emailInput = document.createElement("input");
      emailInput.type = "email";
      emailInput.placeholder = "Paste their email…";
      emailInput.style.cssText = iStyle;

      const nameInput = document.createElement("input");
      nameInput.type = "text";
      nameInput.placeholder = "Their name (auto-detected)";
      nameInput.style.cssText = iStyle;
      nameInput.value = lead?.name || lead?.ig_username || username || "";

      emailInput.addEventListener("input", () => {
        if (!nameInput.dataset.edited) {
          const local = emailInput.value.split("@")[0];
          nameInput.value = local.split(/[._-]/).filter(Boolean).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
        }
      });
      nameInput.addEventListener("input", () => { nameInput.dataset.edited = "1"; });

      const slotLabel = document.createElement("div");
      slotLabel.textContent = "Which time did they confirm?";
      slotLabel.style.cssText = "color:#86efac;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-top:2px";

      const slotSel = document.createElement("select");
      slotSel.style.cssText = iStyle + ";cursor:pointer";
      chosen.forEach((isoStart, i) => {
        const opt = document.createElement("option");
        opt.value = i;
        opt.textContent = calFormatSlot(isoStart);
        slotSel.appendChild(opt);
      });

      const formBtns = document.createElement("div");
      formBtns.style.cssText = "display:flex;gap:6px;margin-top:2px";

      const cancelForm = document.createElement("button");
      cancelForm.textContent = "← Back";
      cancelForm.style.cssText = "flex:0 0 auto;background:transparent;border:1px solid #374151;border-radius:6px;color:#9ca3af;font-size:10px;padding:7px 10px;cursor:pointer";
      cancelForm.addEventListener("click", () => { form.remove(); btnRow.style.display = ""; });

      const createBtn = document.createElement("button");
      createBtn.textContent = "📅 Create Event";
      createBtn.style.cssText = "flex:1;background:#0d2b18;border:1px solid #166534;border-radius:6px;color:#4ade80;font-size:11px;font-weight:600;padding:7px;cursor:pointer";
      createBtn.addEventListener("click", async () => {
        const idx = parseInt(slotSel.value, 10);
        const slot = slots.find(s => s.start === chosen[idx]);
        if (!slot) return;
        const leadName = nameInput.value.trim() || lead?.name || lead?.ig_username || username;
        const guestEmail = emailInput.value.trim() || undefined;
        createBtn.textContent = "Creating…";
        createBtn.disabled = true;
        const result = await chrome.runtime.sendMessage({ type: "CREATE_CALENDAR_EVENT", slotStart: slot.start, slotEnd: slot.end, leadName, guestEmail }).catch(() => null);
        if (result?.ok) {
          form.innerHTML = "";
          const ok = document.createElement("div");
          ok.textContent = "✓ Event created!";
          ok.style.cssText = "color:#4ade80;font-size:12px;font-weight:600;text-align:center;padding:10px 8px";
          form.appendChild(ok);
          setTimeout(() => { picker.remove(); }, 1500);
        } else {
          createBtn.textContent = "✗ Failed — try again";
          createBtn.style.borderColor = "#7f1d1d";
          createBtn.style.color = "#ef4444";
          createBtn.disabled = false;
        }
      });

      formBtns.appendChild(cancelForm);
      formBtns.appendChild(createBtn);
      form.appendChild(emailInput);
      form.appendChild(nameInput);
      form.appendChild(slotLabel);
      form.appendChild(slotSel);
      form.appendChild(formBtns);
      picker.appendChild(form);
    });

    btnRow.appendChild(backBtn);
    btnRow.appendChild(insertBtn);
    btnRow.appendChild(bookEventBtn);
    picker.appendChild(btnRow);
    card.appendChild(picker);
  }

  // ── DM preview (AI opener + stage-aware script picker) ────────────────────

  function showDmPreview(card, b, username, aiOpener, opts) {
    opts = opts || {};
    const bio = document.querySelector('meta[name="description"]')?.content ?? "";

    // IG's H1 is always the username handle, not the real name.
    // og:title is "Real Name (@handle) • Instagram photos and videos"
    function extractRealName() {
      const og = document.querySelector('meta[property="og:title"]')?.content || "";
      const m = og.match(/^(.+?)\s*\(@/);
      if (m && m[1].trim().toLowerCase() !== username.toLowerCase()) return m[1].trim();
      // Fallback: page title has same format
      const t = (document.title || "").match(/^(.+?)\s*\(@/);
      if (t && t[1].trim().toLowerCase() !== username.toLowerCase()) return t[1].trim();
      // Last resort: h2 on the page if it differs from username
      const h2 = document.querySelector("h2")?.textContent?.trim() || "";
      return (h2 && h2.toLowerCase() !== username.toLowerCase()) ? h2 : "";
    }

    const displayName = extractRealName();
    const firstName = (displayName || "").split(/\s+/)[0] || username;
    const lead = opts.lead || null;
    const stage = lead?.stage || "New";
    const channel = opts.channel || "ig_fanbasis";

    const scripts = buildScriptList(lead, displayName || username, bio, aiOpener || null);

    // Prepend cross-channel bridge message when this is the second DM in the two-touch flow
    if (opts.crossChannelIntro) {
      const filled = opts.crossChannelIntro
        .replace(/\[Name\]/g, firstName)
        .replace(/\[name\]/g, firstName.toLowerCase());
      scripts.unshift({ label: "↔ Bridge", text: filled });
    }

    if (opts.bookingScript) {
      const filled = opts.bookingScript
        .replace(/\[Name\]/g, firstName)
        .replace(/\[name\]/g, firstName.toLowerCase());
      scripts.unshift({ label: "📅 Book", text: filled });
    }

    let activeIdx = 0;

    const acctColor = channel === "ig_fanbasis" ? "#22c55e" : channel === "ig_personal" ? "#3b82f6" : "#888";
    const acctLabel = channel === "ig_fanbasis" ? "FanBasis account" : channel === "ig_personal" ? "Personal account" : "DM";

    b.style.display = "none";

    const preview = document.createElement("div");
    preview.style.cssText = "padding:12px 14px";

    // Header: name + account badge + stage
    const hdr = document.createElement("div");
    hdr.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:8px";
    hdr.innerHTML = `
      <div style="display:flex;align-items:center;gap:5px;min-width:0">
        <span style="width:6px;height:6px;border-radius:50%;background:${acctColor};display:inline-block;flex-shrink:0"></span>
        <span style="font-size:10px;font-weight:600;color:#bbb;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${firstName}</span>
        <span style="font-size:9px;color:#333;white-space:nowrap">· ${acctLabel}</span>
      </div>
      ${stage !== "New" ? `<span style="font-size:9px;color:#888;background:#1a1a1a;border:1px solid #252525;padding:1px 7px;border-radius:5px;flex-shrink:0">${stage}</span>` : ""}
    `;
    preview.appendChild(hdr);

    // AI badge shown while loading
    const aiBadge = document.createElement("div");
    aiBadge.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:5px;font-size:9px;color:#7c3aed";
    aiBadge.innerHTML = `<span style="display:inline-block;width:7px;height:7px;border-radius:50%;background:#7c3aed;animation:fbPulse 1s ease-in-out infinite"></span>✨ Generating AI opener…`;
    preview.appendChild(aiBadge);

    const ta = document.createElement("textarea");
    ta.value = scripts[0].text;
    ta.placeholder = "Loading…";
    ta.style.cssText = "width:100%;min-height:90px;max-height:220px;background:#0f0f12;border:1px solid #2a2a35;border-radius:8px;color:#ddd;font-size:12px;line-height:1.55;padding:8px 10px;resize:none;font-family:inherit;outline:none;box-sizing:border-box;overflow-y:auto;transition:border-color .2s";

    function autoResizeTa() {
      ta.style.height = "auto";
      ta.style.height = Math.min(ta.scrollHeight + 2, 220) + "px";
    }
    ta.addEventListener("input", autoResizeTa);
    preview.appendChild(ta);
    requestAnimationFrame(autoResizeTa);

    // Script picker container (rebuilt after AI loads)
    const pickerWrap = document.createElement("div");
    preview.appendChild(pickerWrap);

    function rebuildPicker(scriptList) {
      pickerWrap.innerHTML = "";
      if (scriptList.length <= 1) return;
      const picker = document.createElement("div");
      picker.style.cssText = "display:flex;gap:4px;flex-wrap:wrap;margin-top:5px";

      function setPillActive(pills, idx) {
        pills.forEach((p, i) => {
          const on = i === idx;
          p.style.borderColor = on ? "#FF3A69" : "#1e1e2a";
          p.style.background = on ? "#FF3A6922" : "transparent";
          p.style.color = on ? "#FF3A69" : "#444";
        });
      }

      const pills = scriptList.map((s, i) => {
        const pill = document.createElement("button");
        pill.textContent = s.label;
        pill.title = s.text;
        pill.style.cssText = "font-size:9px;padding:2px 7px;border-radius:5px;cursor:pointer;border:1px solid #1e1e2a;background:transparent;color:#444;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:120px";
        pill.addEventListener("click", () => {
          activeIdx = i;
          ta.value = s.text;
          autoResizeTa();
          setPillActive(pills, i);
        });
        picker.appendChild(pill);
        return pill;
      });

      setPillActive(pills, 0);
      pickerWrap.appendChild(picker);
    }

    rebuildPicker(scripts);

    // Async: fetch AI opener from dashboard, update textarea when ready
    getSettings().then(({ dashboardUrl: dUrl }) => {
      const leadId = opts.leadId || opts.lead?.id;
      const followerCount = (() => {
        try {
          const txt = document.body?.innerText || "";
          const m = txt.match(/([\d,.]+[KkMm]?)\s*(followers|seguidores)/i);
          return m ? m[1] : "";
        } catch { return ""; }
      })();
      const url = `${dUrl}/api/opener?channel=${encodeURIComponent(channel)}&ig_username=${encodeURIComponent(username)}&name=${encodeURIComponent(displayName || username)}&bio=${encodeURIComponent(bio.slice(0,200))}&followers=${encodeURIComponent(followerCount)}${leadId ? `&lead_id=${leadId}` : ""}`;

      const ctrl = new AbortController();
      const abortTimer = setTimeout(() => ctrl.abort(), 9000);

      repAuthHeader()
        .then(auth => fetch(url, { signal: ctrl.signal, headers: auth }))
        .then(r => {
          clearTimeout(abortTimer);
          if (!r.ok) throw new Error(`opener API ${r.status}`);
          return r.json();
        })
        .then(data => {
          if (!data?.opener) { aiBadge.remove(); return; }
          aiBadge.innerHTML = `<span style="color:#7c3aed">✨</span> AI opener`;
          aiBadge.style.animation = "none";
          ta.style.borderColor = "#7c3aed44";
          const aiScripts = [{ label: "✨ AI", text: data.opener }, ...scripts];
          if (!sent && !clicked) {
            ta.value = aiScripts[0].text;
            autoResizeTa();
          }
          rebuildPicker(aiScripts);
        })
        .catch((err) => {
          clearTimeout(abortTimer);
          console.warn("[FanBasis] opener fetch failed:", err?.message || err);
          aiBadge.innerHTML = `<span style="color:#f59e0b">⚠ AI failed — using template</span>`;
          setTimeout(() => { try { aiBadge.remove(); } catch {} }, 3000);
        });
    });

    const btnRow = document.createElement("div");
    btnRow.style.cssText = "display:flex;gap:6px;margin-top:8px";

    const confirmBtn = document.createElement("button");
    confirmBtn.textContent = "📨 Send";
    confirmBtn.style.cssText = "flex:1;background:#FF3A69;border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:600;padding:9px 8px;cursor:pointer";

    // Invariant: lead state advances only when the network confirms the send
    // (ig_dm_sent, Contract A) or a human explicitly attests ("✓ I sent it") —
    // never on the mere act of clicking Send.
    const SEND_CONFIRM_TIMEOUT_MS = 8000;
    let sent = false;
    let clicked = false;
    let confirmTimer = null;

    function cleanupSendWatch() {
      document.removeEventListener("ig_dm_sent", onDmSent);
      clearTimeout(confirmTimer);
      confirmTimer = null;
      if (activeSendWatchCancel === cleanupSendWatch) activeSendWatchCancel = null;
    }

    function commitSent() {
      if (sent) return;
      sent = true;
      cleanupSendWatch();

      if (opts.channel) {
        const leadId = opts.leadId || opts.lead?.id;
        const outreachChannels = opts.outreachChannels || opts.lead?.outreach_channels || {};
        if (leadId) {
          getSettings().then(({ dashboardUrl: dUrl }) => {
            markChannelSent(leadId, opts.channel, outreachChannels, opts.dashboardUrl || dUrl)
              .then(() => {
                markPillSent(card, opts.channel);
                // Fire FB_DM_SENT after channel is persisted so cache refresh sees the update
                chrome.runtime.sendMessage({ type: "FB_DM_SENT", username, leadId, channel: opts.channel, currentStage: opts.lead?.stage }).catch(() => {});
              });
          });
        } else {
          markPillSent(card, opts.channel);
          chrome.runtime.sendMessage({ type: "FB_DM_SENT", username, leadId, channel: opts.channel, currentStage: opts.lead?.stage }).catch(() => {});
        }
      }

      preview.remove();
      b.style.display = "";
      if (opts.afterSend) opts.afterSend({ confirmed: true });
    }

    function onDmSent() { commitSent(); }

    confirmBtn.addEventListener("click", () => {
      if (sent || clicked) return;
      clicked = true;

      if (activeSendWatchCancel) activeSendWatchCancel();
      activeSendWatchCancel = cleanupSendWatch;

      const text = ta.value.trim();
      if (text) navigator.clipboard.writeText(text).catch(() => {});
      openIgDm(username);
      if (text) setTimeout(() => autoTypeInIgDm(text), 1200);
      autoConfirmIgDialog();

      // Pending: wait for the network to confirm the send actually happened
      confirmBtn.textContent = "⏳ Waiting for send…";
      confirmBtn.disabled = true;
      confirmBtn.style.background = "#1a1a1a";
      confirmBtn.style.border = "1px solid #333";
      confirmBtn.style.color = "#888";
      confirmBtn.style.cursor = "default";

      document.addEventListener("ig_dm_sent", onDmSent);

      // No confirmation in time → require explicit human attestation instead
      confirmTimer = setTimeout(() => {
        confirmTimer = null;
        if (sent) return;
        confirmBtn.textContent = "✓ I sent it";
        confirmBtn.disabled = false;
        confirmBtn.style.background = "#166534";
        confirmBtn.style.border = "1px solid #22c55e";
        confirmBtn.style.color = "#4ade80";
        confirmBtn.style.cursor = "pointer";
        confirmBtn.addEventListener("click", commitSent, { once: true });
      }, SEND_CONFIRM_TIMEOUT_MS);
    });

    const backBtn = document.createElement("button");
    backBtn.textContent = "← Back";
    backBtn.style.cssText = "background:#161616;border:1px solid #252525;border-radius:8px;color:#94a3b8;font-size:12px;font-weight:600;padding:9px 12px;cursor:pointer;flex-shrink:0";
    backBtn.addEventListener("click", () => {
      cleanupSendWatch();
      preview.remove();
      b.style.display = "";
    });

    btnRow.appendChild(confirmBtn);
    btnRow.appendChild(backBtn);
    preview.appendChild(btnRow);
    card.appendChild(preview);
    ta.focus();
  }

  function autoTriggerIgSwitch() {
    let attempt = 0;

    function verifyOrRetry() {
      // If "Switch accounts" appeared, our click worked — watchSwitchMenu handles the rest
      if (findVisibleByText(/switch.?accounts?/i)) return;
      // Menu didn't open; try again with next strategy/attempt
      if (attempt < 10) setTimeout(tryClick, 300);
    }

    function tryClick() {
      attempt++;

      // Strategy 1: findVisibleByText for "More" — same approach watchSwitchMenu uses.
      // Avoids nav/aria selectors that break when IG uses div[role="navigation"] instead of <nav>.
      const moreEl = findVisibleByText(/^more$/i);
      if (moreEl) {
        let btn = moreEl;
        while (btn && btn !== document.body) {
          const tag = btn.tagName.toLowerCase();
          const role = (btn.getAttribute("role") || "").toLowerCase();
          if (tag === "button" || tag === "a" || role === "button" || role === "menuitem") break;
          btn = btn.parentElement;
        }
        (btn || moreEl).click();
        setTimeout(verifyOrRetry, 300);
        return;
      }

      // Strategy 2: aria-label="More" or "Settings" anywhere visible (no nav restriction)
      const byAria = [...document.querySelectorAll("[aria-label]")]
        .find(el => /^(more|settings|more options)$/i.test(el.getAttribute("aria-label") || "") && el.offsetParent);
      if (byAria) {
        (byAria.closest("button,a,[role='button']") || byAria).click();
        setTimeout(verifyOrRetry, 300);
        return;
      }

      // Strategy 3: any button/role=button in the left sidebar region with text "More"
      const sidebarEls = [...document.querySelectorAll("button,[role='button']")]
        .filter(el => {
          if (!el.offsetParent) return false;
          const rect = el.getBoundingClientRect();
          return rect.left < 280 && /more/i.test(el.textContent || "");
        });
      if (sidebarEls.length > 0) {
        sidebarEls[0].click();
        setTimeout(verifyOrRetry, 300);
        return;
      }

      if (attempt < 10) setTimeout(tryClick, 500);
    }
    tryClick();
  }

  function renderSmartDmBtn(card, b, username, lead, opener, dashboardUrl) {
    // Insert placeholder synchronously so Send DM lands in the right DOM position
    const wrap = document.createElement("div");
    wrap.style.cssText = "margin-bottom:8px";
    b.appendChild(wrap);

    // Kick off a fresh account detection — page-interceptor updates storage async
    document.dispatchEvent(new CustomEvent("ig_viewer_check", { bubbles: true, composed: true }));

    // Wait 150ms for interceptor + storage write, then read the freshened value
    const detect = () => Promise.all([
      getSettings(),
      new Promise(r => chrome.storage.local.get({ activeIgAccount: "", activeIgAccountTs: 0 }, r)),
    ]);

    new Promise(r => setTimeout(r, 150)).then(detect).then(([{ personalIgUsername, fanbasisHandle: fbH }, { activeIgAccount, activeIgAccountTs }]) => {
      const fbAcct  = (fbH || "fanbasis").replace(/^@/, "").toLowerCase();
      const persAcct = (personalIgUsername || "").toLowerCase();
      // activeIgAccount comes from page-interceptor reading real IG API responses,
      // trusted only while fresh (Contract B); otherwise fall back to DOM detection
      const currentAcct = (freshActiveIgAccount(activeIgAccount, activeIgAccountTs) || detectCurrentIgAccountFromDom() || "").toLowerCase();
      const isOnFb   = !!currentAcct && currentAcct === fbAcct;
      const isOnPers = !!currentAcct && currentAcct === persAcct;

      // No silent default: if the account can't be confirmed as FB or Personal,
      // the rep must pick one before Send enables
      let firstCh = isOnFb ? "ig_fanbasis" : isOnPers ? "ig_personal" : null;
      const secondChOf = (ch) => ch === "ig_personal" ? "ig_fanbasis" : "ig_personal";
      const secondTargetOf = (ch) => secondChOf(ch) === "ig_personal" ? persAcct : fbAcct;

      const acctColor = isOnFb ? "#22c55e" : isOnPers ? "#3b82f6" : "#f59e0b";
      const acctLabel = currentAcct ? `@${currentAcct}` : "Account not detected";

      // Pill row: current account indicator + switch button
      const pillRow = document.createElement("div");
      pillRow.style.cssText = "display:flex;align-items:center;justify-content:space-between;margin-bottom:5px";

      const pill = document.createElement("div");
      pill.style.cssText = "display:flex;align-items:center;gap:5px;font-size:10px;color:#555";
      pill.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:${acctColor};display:inline-block;flex-shrink:0"></span>${acctLabel}`;
      pillRow.appendChild(pill);

      // Switch account button — visible once the current account is confirmed
      if (firstCh && secondTargetOf(firstCh)) {
        const otherLabel = `@${secondTargetOf(firstCh)}`;
        const switchLink = document.createElement("button");
        switchLink.textContent = `⇄ switch to ${otherLabel}`;
        switchLink.style.cssText = "background:none;border:none;color:#3b82f6;font-size:9px;font-weight:600;cursor:pointer;padding:0;text-decoration:underline;text-underline-offset:2px";
        switchLink.addEventListener("click", () => {
          renderSwitchPrompt(card, b, username, secondChOf(firstCh), lead, null, null);
        });
        pillRow.appendChild(switchLink);
      }

      wrap.appendChild(pillRow);

      const dmBtn = document.createElement("button");
      dmBtn.textContent = "📨 Send DM";
      dmBtn.style.cssText = "width:100%;background:#FF3A69;border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:600;padding:9px;cursor:pointer";

      // Unknown account → block Send until the rep confirms which one they're on,
      // so a DM is never silently sent (and tagged) as FanBasis by default
      if (!firstCh) {
        dmBtn.disabled = true;
        dmBtn.style.opacity = ".45";
        dmBtn.style.cursor = "default";

        const notice = document.createElement("div");
        notice.style.cssText = "background:#2d1a00;border:1px solid #92400e;border-radius:7px;padding:7px 9px;margin-bottom:5px";
        const noticeLabel = document.createElement("div");
        noticeLabel.textContent = "Confirm which account you're on";
        noticeLabel.style.cssText = "font-size:10px;color:#fbbf24;font-weight:600;margin-bottom:5px";
        notice.appendChild(noticeLabel);

        const pickRow = document.createElement("div");
        pickRow.style.cssText = "display:flex;gap:5px";
        function mkPick(label, ch, dotColor) {
          const pb = document.createElement("button");
          pb.textContent = label;
          pb.style.cssText = "flex:1;background:#161616;border:1px solid #2a2a35;border-radius:6px;color:#94a3b8;font-size:10px;font-weight:600;padding:5px 4px;cursor:pointer";
          pb.addEventListener("click", () => {
            firstCh = ch;
            notice.remove();
            dmBtn.disabled = false;
            dmBtn.style.opacity = "";
            dmBtn.style.cursor = "pointer";
            const handle = ch === "ig_fanbasis" ? fbAcct : persAcct;
            pill.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:${dotColor};display:inline-block;flex-shrink:0"></span>@${handle} · confirmed by you`;
          });
          return pb;
        }
        pickRow.appendChild(mkPick(`FanBasis (@${fbAcct})`, "ig_fanbasis", "#22c55e"));
        if (persAcct) pickRow.appendChild(mkPick(`Personal (@${persAcct})`, "ig_personal", "#3b82f6"));
        notice.appendChild(pickRow);
        wrap.appendChild(notice);
      }

      wrap.appendChild(dmBtn);

      function completeBothSends() {
        wrap.remove();
        if (lead?.id) {
          const due = new Date(Date.now() + 3 * 24 * 3600000).toISOString();
          chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { stage: "DM Sent", last_contact_at: new Date().toISOString(), due_at: due } }).catch(() => {});
          const chs = lead.outreach_channels || {};
          markChannelSent(lead.id, "ig_fanbasis", chs, dashboardUrl).catch(() => {});
          markChannelSent(lead.id, "ig_personal", chs, dashboardUrl).catch(() => {});
          chrome.runtime.sendMessage({ type: "FB_DM_SENT", username, leadId: lead.id, channel: "ig_fanbasis" }).catch(() => {});
          chrome.runtime.sendMessage({ type: "FB_DM_SENT", username, leadId: lead.id, channel: "ig_personal" }).catch(() => {});
        }
        const done = document.createElement("div");
        done.style.cssText = "margin-bottom:8px;padding:8px 10px;background:#0d2b0d;border:1px solid #166534;border-radius:7px;color:#4ade80;font-size:11px;font-weight:600;text-align:center";
        done.textContent = "✓ Both channels done — DM Sent!";
        b.appendChild(done);
        // Next lead button
        chrome.runtime.sendMessage({ type: "GET_LEADS" }, async (resp) => {
          const { fb_snoozed = {} } = await chrome.storage.local.get({ fb_snoozed: {} }).catch(() => ({ fb_snoozed: {} }));
          const queue = window.FBQueue.buildQueue(resp?.leads || [], { channel: "ig", snoozed: fb_snoozed });
          const nextLead = queue.find((l) => l.id !== lead?.id);
          if (nextLead) {
            const nextUrl = nextLead.ig_profile_url || `https://www.instagram.com/${nextLead.ig_username}/`;
            const nextBtn = document.createElement("button");
            nextBtn.textContent = `Next → @${nextLead.ig_username || nextLead.name}`;
            nextBtn.style.cssText = "width:100%;background:#161616;border:1px solid #3b82f6;border-radius:7px;color:#93c5fd;font-size:11px;font-weight:600;padding:7px;cursor:pointer";
            nextBtn.addEventListener("click", () => { window.location.href = nextUrl; });
            b.appendChild(nextBtn);
          }
        });
      }

      function handleAfterFirstSend(commit) {
        const firstTouchConfirmed = !!(commit && commit.confirmed);
        const secondCh = secondChOf(firstCh);
        const secondTarget = secondTargetOf(firstCh);
        if (!secondTarget) { completeBothSends(); return; }

        // Build cross-channel bridge message for the second DM — but only if
        // touch #1 actually went out (commitSent ran). An unconfirmed first
        // touch gets a standalone opener instead of a bridge referencing it.
        const crossChannelIntro = !firstTouchConfirmed ? null : firstCh === "ig_fanbasis"
          ? `Hey [Name] — it's me again from my personal (@${persAcct})! I also just messaged you from @${fbAcct} — wanted to reach out from both so you have options.\n\nHappy to connect on either one!`
          : `Hey [Name] — on the partnerships team at @${fbAcct}. I also just reached out to you from my personal (@${persAcct}).\n\nWe work with high-ticket creators through lower fees, BNPL at checkout, and a lead qualifier that screens buyers before the call. Happy to find time this week if it makes sense.`;

        // Auto-trigger the IG account switcher immediately
        setTimeout(autoTriggerIgSwitch, 400);
        // Show switch prompt (watches for switch + sets pendingDm for post-nav second touch)
        renderSwitchPrompt(card, b, username, secondCh, lead, () => {
          showDmPreview(card, b, username, null, {
            channel: secondCh,
            leadId: lead?.id,
            lead,
            dashboardUrl,
            crossChannelIntro,
            afterSend: completeBothSends,
          });
        }, crossChannelIntro);
      }

      dmBtn.addEventListener("click", () => {
        showDmPreview(card, b, username, null, {
          channel: firstCh,
          leadId: lead?.id,
          lead,
          dashboardUrl,
          afterSend: handleAfterFirstSend,
        });
      });
    }).catch(() => {
      // Fallback if settings load fails — show plain Send DM button
      const dmBtn = document.createElement("button");
      dmBtn.textContent = "📨 Send DM";
      dmBtn.style.cssText = "width:100%;background:#FF3A69;border:none;border-radius:8px;color:#fff;font-size:12px;font-weight:600;padding:9px;cursor:pointer";
      dmBtn.addEventListener("click", () => {
        showDmPreview(card, b, username, opener, { channel: "ig_fanbasis", lead, leadId: lead?.id, dashboardUrl });
      });
      wrap.appendChild(dmBtn);
    });
  }

  // ── State renderers ─────────────────────────────────────────────────────────

  function renderLoading(username) {
    const card = buildCard();
    renderHeader(card, username);
    const b = document.createElement("div");
    b.style.cssText = "padding:12px 14px";
    b.innerHTML = `<div style="display:flex;align-items:center;gap:8px;color:#555"><div style="width:7px;height:7px;background:#FF3A69;border-radius:50%;animation:fb-pulse 1s infinite;flex-shrink:0"></div><span>Checking…</span></div>`;
    card.appendChild(b);
  }

  function renderUnsaved(username, dashboardUrl, igSecret, calendarUrl, autoDm, crossChannelIntro) {
    const card = buildCard();
    renderHeader(card, username);
    const b = document.createElement("div");
    b.style.cssText = "padding:12px 14px";

    const bio = document.querySelector('meta[name="description"]')?.content ?? "";
    const displayName = document.querySelector("h1")?.textContent?.trim() || username;
    const suggestion = quickSuggest(displayName, bio);

    const topRow = document.createElement("div");
    topRow.style.cssText = "display:flex;gap:6px;margin-bottom:8px";

    const btn = document.createElement("button");
    btn.id = "fb-save-btn";
    btn.textContent = "＋ Save to Leads";
    btn.style.cssText = "flex:1;background:#FF3A69;color:#fff;border:none;border-radius:8px;padding:9px 8px;font-size:12px;font-weight:600;cursor:pointer;transition:opacity .15s";

    topRow.appendChild(btn);
    b.appendChild(topRow);

    renderChannelTracker(b, {});

    renderSmartDmBtn(card, b, username, null, suggestion ? suggestion.text : null, dashboardUrl);

    if (suggestion) {
      const scriptBox = document.createElement("div");
      scriptBox.style.cssText = "background:#0f0f12;border:1px solid #1e1e28;border-radius:8px;padding:9px 10px;position:relative";
      const chipHtml = suggestion.stack.slice(0, 3)
        .map(s => `<span style="font-size:9px;background:#1a1a22;border:1px solid #2a2a35;color:#555;padding:1px 6px;border-radius:6px">${s}</span>`)
        .join("");
      scriptBox.innerHTML = `
        <div style="display:flex;align-items:center;gap:5px;margin-bottom:5px;flex-wrap:wrap">
          <span style="font-size:9px;color:#3b3b50;text-transform:uppercase;letter-spacing:.5px">Quick Script</span>
          ${chipHtml}
        </div>
        <p id="fb-quick-text" style="margin:0;color:#bbb;font-size:12px;line-height:1.55;white-space:pre-wrap;padding-right:54px">${suggestion.text}</p>
        <button id="fb-copy-quick" style="position:absolute;top:8px;right:8px;background:#FF3A69;border:none;border-radius:5px;color:#fff;font-size:10px;font-weight:600;padding:3px 9px;cursor:pointer">Copy</button>
      `;
      b.appendChild(scriptBox);
      scriptBox.querySelector("#fb-copy-quick").addEventListener("click", function () {
        navigator.clipboard.writeText(suggestion.text).then(() => {
          this.textContent = "✓";
          setTimeout(() => { this.textContent = "Copy"; }, 1500);
        });
      });
    }

    card.appendChild(b);

    btn.addEventListener("click", async () => {
      btn.textContent = "Saving…";
      btn.disabled = true;
      try {
        const result = await saveLead(username, dashboardUrl, igSecret);
        chrome.runtime.sendMessage({ type: "REFRESH_CACHE" }).catch(() => {});
        renderSaved(username, dashboardUrl, result?.leadId ? { id: result.leadId } : null, calendarUrl);
      } catch {
        btn.textContent = "✕ Save failed — queued for retry";
        btn.style.background = "#7f1d1d";
        btn.disabled = false;
      }
    });

    if (autoDm) showDmPreview(card, b, username, suggestion?.text || null, { channel: autoDm, crossChannelIntro });
  }

  function navigateToNextLead(container, username, currentLeadId, dashboardUrl) {
    chrome.runtime.sendMessage({ type: "GET_LEADS" }, async (resp) => {
      const all = resp?.leads || [];
      const { fb_snoozed = {} } = await chrome.storage.local.get({ fb_snoozed: {} }).catch(() => ({ fb_snoozed: {} }));
      const queue = window.FBQueue.buildQueue(all, { channel: "ig", snoozed: fb_snoozed });
      const pos = queue.findIndex((l) => l.id === currentLeadId);
      const nextLead = queue.find((l) => l.id !== currentLeadId);
      if (!nextLead) return;

      const navWrap = document.createElement("div");
      navWrap.style.cssText = "margin-top:8px;border-top:1px solid #1a1a22;padding-top:8px";

      // Position counter + snooze strip
      const controlRow = document.createElement("div");
      controlRow.style.cssText = "display:flex;align-items:center;gap:5px;margin-bottom:6px";
      if (pos !== -1) {
        const posLabel = document.createElement("span");
        posLabel.style.cssText = "font-size:10px;color:#3a3a50;font-variant-numeric:tabular-nums;flex-shrink:0";
        posLabel.textContent = `${pos + 1} / ${queue.length}`;
        controlRow.appendChild(posLabel);
      }
      const snoozeLabel = document.createElement("span");
      snoozeLabel.style.cssText = "font-size:10px;color:#3a3a50;margin-left:auto;flex-shrink:0";
      snoozeLabel.textContent = "Snooze:";
      controlRow.appendChild(snoozeLabel);
      for (const [label, days] of [["1d", 1], ["3d", 3], ["1w", 7]]) {
        const sb = document.createElement("button");
        sb.textContent = `+${label}`;
        sb.style.cssText = "background:#111;border:1px solid #252525;border-radius:4px;color:#444;font-size:10px;font-weight:600;padding:2px 6px;cursor:pointer";
        sb.addEventListener("click", async () => {
          // C4: server-side snooze (background does the authed POST)
          const until = new Date(Date.now() + days * 24 * 3600000).toISOString();
          await chrome.runtime.sendMessage({ type: "SNOOZE_LEAD", id: currentLeadId, until }).catch(() => {});
          window.location.href = nextLead.ig_profile_url || `https://www.instagram.com/${nextLead.ig_username}/`;
        });
        controlRow.appendChild(sb);
      }
      navWrap.appendChild(controlRow);

      // Skip / Next buttons
      const btnRow = document.createElement("div");
      btnRow.style.cssText = "display:flex;gap:5px";
      const skipBtn = document.createElement("button");
      skipBtn.textContent = "Skip";
      skipBtn.style.cssText = "flex:1;background:#111;border:1px solid #252525;border-radius:6px;color:#555;font-size:11px;font-weight:600;padding:5px;cursor:pointer";
      skipBtn.addEventListener("click", () => {
        dismissedFor = username;
        window.location.href = nextLead.ig_profile_url || `https://www.instagram.com/${nextLead.ig_username}/`;
      });
      const nextBtn = document.createElement("button");
      nextBtn.textContent = `Next → @${nextLead.ig_username || nextLead.name}`;
      nextBtn.style.cssText = "flex:2;background:#161616;border:1px solid #3b82f6;border-radius:6px;color:#93c5fd;font-size:11px;font-weight:600;padding:5px;cursor:pointer";
      nextBtn.addEventListener("click", () => {
        window.location.href = nextLead.ig_profile_url || `https://www.instagram.com/${nextLead.ig_username}/`;
      });
      btnRow.appendChild(skipBtn);
      btnRow.appendChild(nextBtn);
      navWrap.appendChild(btnRow);
      container.appendChild(navWrap);
    });
  }

  function renderSaved(username, dashboardUrl, lead, calendarUrl, autoDm, secondTouch, crossChannelIntro) {
    const card = buildCard();
    renderHeader(card, username);
    const b = document.createElement("div");
    b.style.cssText = "padding:12px 14px";

    const savedRow = document.createElement("div");
    savedRow.style.cssText = "display:flex;align-items:center;gap:6px;margin-bottom:10px";
    savedRow.innerHTML = `<span style="font-size:12px;color:#22c55e;font-weight:600">✓ Saved to leads</span>`;
    if (lead?.id) {
      const viewLink = document.createElement("a");
      viewLink.href = `${dashboardUrl}/leads/${lead.id}`;
      viewLink.target = "_blank";
      viewLink.style.cssText = "margin-left:auto;color:#FF3A69;font-size:11px;text-decoration:none;font-weight:600";
      viewLink.textContent = "View →";
      savedRow.appendChild(viewLink);
    }
    b.appendChild(savedRow);

    const bio = document.querySelector('meta[name="description"]')?.content ?? "";
    const displayName = document.querySelector("h1")?.textContent?.trim() || username;
    const suggestion = quickSuggest(displayName, bio);

    if (suggestion) {
      const scriptBox = document.createElement("div");
      scriptBox.style.cssText = "background:#0f0f12;border:1px solid #1e1e28;border-radius:8px;padding:9px 10px;margin-bottom:10px;position:relative";
      const chipHtml = suggestion.stack.slice(0, 3)
        .map(s => `<span style="font-size:9px;background:#1a1a22;border:1px solid #2a2a35;color:#555;padding:1px 6px;border-radius:6px">${s}</span>`)
        .join("");
      scriptBox.innerHTML = `
        <div style="display:flex;align-items:center;gap:5px;margin-bottom:5px;flex-wrap:wrap">
          <span style="font-size:9px;color:#3b3b50;text-transform:uppercase;letter-spacing:.5px">Suggested Message</span>
          ${chipHtml}
        </div>
        <p style="margin:0;color:#bbb;font-size:12px;line-height:1.55;white-space:pre-wrap;padding-right:54px">${suggestion.text}</p>
        <button id="fb-copy-sugg" style="position:absolute;top:8px;right:8px;background:#FF3A69;border:none;border-radius:5px;color:#fff;font-size:10px;font-weight:600;padding:3px 9px;cursor:pointer">Copy</button>
      `;
      b.appendChild(scriptBox);
      scriptBox.querySelector("#fb-copy-sugg").addEventListener("click", function () {
        navigator.clipboard.writeText(suggestion.text).then(() => {
          this.textContent = "✓";
          setTimeout(() => { this.textContent = "Copy"; }, 1500);
        });
      });
    } else {
      const noScript = document.createElement("p");
      noScript.style.cssText = "margin:0 0 10px;color:#555;font-size:11px";
      noScript.textContent = "Saved — open dashboard to view research when ready.";
      b.appendChild(noScript);
    }

    if (lead?.id) {
      const savedActions = document.createElement("div");
      savedActions.style.cssText = "display:flex;gap:5px;margin-top:6px";
      const savedDqBtn = document.createElement("button");
      savedDqBtn.textContent = "✗ DQ";
      savedDqBtn.style.cssText = "flex:1;background:#161616;border:1px solid #7f1d1d;border-radius:6px;color:#ef4444;font-size:11px;font-weight:600;padding:5px;cursor:pointer";
      savedDqBtn.addEventListener("click", () => {
        if (savedDqBtn.dataset.undoing) {
          clearTimeout(Number(savedDqBtn.dataset.timer));
          delete savedDqBtn.dataset.undoing;
          savedDqBtn.textContent = "✗ DQ";
          savedDqBtn.style.cssText = "flex:1;background:#161616;border:1px solid #7f1d1d;border-radius:6px;color:#ef4444;font-size:11px;font-weight:600;padding:5px;cursor:pointer";
          return;
        }
        savedDqBtn.dataset.undoing = "1";
        savedDqBtn.textContent = "↩ Undo";
        savedDqBtn.style.cssText = "flex:1;background:#1a1a1a;border:1px solid #444;border-radius:6px;color:#888;font-size:11px;font-weight:600;padding:5px;cursor:pointer";
        savedDqBtn.dataset.timer = setTimeout(async () => {
          delete savedDqBtn.dataset.undoing;
          savedDqBtn.textContent = "DQ'd"; savedDqBtn.disabled = true;
          const r = await chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { stage: "DQ" } }).catch(() => null);
          if (r?.ok === false) { savedDqBtn.textContent = "✗ DQ"; savedDqBtn.disabled = false; savedDqBtn.style.cssText = "flex:1;background:#161616;border:1px solid #7f1d1d;border-radius:6px;color:#ef4444;font-size:11px;font-weight:600;padding:5px;cursor:pointer"; return; }
          navigateToNextLead(b, username, lead.id, dashboardUrl);
        }, 4000);
      });

      // 📅 Book a Call — uses Google Calendar slots if connected, else falls back to script DM
      const savedBookCalBtn = document.createElement("button");
      savedBookCalBtn.textContent = "📅 Book a Call";
      savedBookCalBtn.style.cssText = "flex:1;background:#0f2540;border:1px solid #1d4ed8;border-radius:6px;color:#93c5fd;font-size:11px;font-weight:600;padding:5px;cursor:pointer";
      savedBookCalBtn.addEventListener("click", async () => {
        if (savedBookCalBtn.dataset.connect) {
          // Second click after "Connect calendar" — re-sign-in upgrades the Google scope
          delete savedBookCalBtn.dataset.connect;
          savedBookCalBtn.textContent = "📅 Book a Call";
          chrome.runtime.sendMessage({ type: "SIGN_IN" }).catch(() => {});
          return;
        }
        savedBookCalBtn.textContent = "Checking…";
        savedBookCalBtn.disabled = true;
        const result = await chrome.runtime.sendMessage({ type: "GET_CALENDAR_SLOTS" }).catch(() => null);
        savedBookCalBtn.textContent = "📅 Book a Call";
        savedBookCalBtn.disabled = false;
        if (result?.ok && result.slots && result.slots.length) {
          showSlotPicker(card, b, username, lead, dashboardUrl, result.slots, result.slotMins);
        } else if (result?.needsCalendar || result?.needsSignIn) {
          savedBookCalBtn.dataset.connect = "1";
          savedBookCalBtn.textContent = "🔗 Connect calendar";
        } else {
          const calScript = calendarUrl
            ? `Hey [Name] — happy to walk you through the dashboard, no pitch, just 15 min to show you what it looks like with your numbers.\n\nHere's my link: ${calendarUrl} — grab whatever works and I'll send context beforehand.`
            : `Hey [Name] — happy to walk you through the dashboard, no pitch, just 15 min to show you what it looks like with your numbers. lmk if that makes sense.`;
          showDmPreview(card, b, username, null, {
            lead,
            leadId: lead.id,
            channel: "ig_fanbasis",
            dashboardUrl,
            bookingScript: calScript,
            afterSend: () => {
              chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { stage: "Call Offered" } }).catch(() => {});
              setTimeout(() => updateCardForProfile(), 500);
            },
          });
        }
      });

      // ✓ Mark Sent — quick-mark without opening DM composer
      const savedDmSentBtn = document.createElement("button");
      savedDmSentBtn.textContent = "✓ Mark Sent";
      savedDmSentBtn.style.cssText = "flex:1;background:#0f1729;border:1px solid #1e3a5f;border-radius:6px;color:#60a5fa;font-size:11px;font-weight:600;padding:5px;cursor:pointer";
      savedDmSentBtn.addEventListener("click", async () => {
        savedDmSentBtn.textContent = "✓✓"; savedDmSentBtn.disabled = true;
        const due = new Date(Date.now() + 3 * 24 * 3600000).toISOString();
        const r = await chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { stage: "DM Sent", last_contact_at: new Date().toISOString(), due_at: due } }).catch(() => null);
        if (r?.ok === false) { savedDmSentBtn.textContent = "✓ Mark Sent"; savedDmSentBtn.disabled = false; return; }
        navigateToNextLead(b, username, lead.id, dashboardUrl);
      });

      savedActions.appendChild(savedDqBtn);
      savedActions.appendChild(savedBookCalBtn);
      savedActions.appendChild(savedDmSentBtn);
      renderSmartDmBtn(card, b, username, lead, suggestion ? suggestion.text : null, dashboardUrl);
      b.appendChild(savedActions);

      // Stage dropdown for research-pending leads
      const savedStageRow = document.createElement("div");
      savedStageRow.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:6px";
      const sc2 = stageColor(lead.stage);
      const savedStageOptions = STAGES.map(s =>
        `<option value="${s}"${lead.stage === s ? " selected" : ""}>${s}</option>`
      ).join("");
      savedStageRow.innerHTML = `<select id="fb-stage-saved" style="flex:1;background:#1a1a1a;border:1px solid ${sc2}55;border-radius:7px;color:${sc2};font-size:12px;font-weight:600;padding:5px 8px;cursor:pointer">${savedStageOptions}</select>`;
      b.appendChild(savedStageRow);
      savedStageRow.querySelector("select").addEventListener("change", function () {
        this.style.color = stageColor(this.value);
        this.style.borderColor = stageColor(this.value) + "55";
        chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { stage: this.value } }).catch(() => {});
      });

      navigateToNextLead(b, username, lead.id, dashboardUrl);
    }

    if (autoDm) {
      const afterSendFn = secondTouch ? () => {
        chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: secondTouch.leadId, updates: { stage: "DM Sent", last_contact_at: new Date().toISOString(), due_at: new Date(Date.now() + 3*24*3600000).toISOString() } }).catch(() => {});
        const done = document.createElement("div");
        done.style.cssText = "margin-top:8px;padding:8px 10px;background:#0d2b0d;border:1px solid #166534;border-radius:7px;color:#4ade80;font-size:11px;font-weight:600;text-align:center";
        done.textContent = "✓ Both channels done — DM Sent!";
        b.appendChild(done);
        chrome.runtime.sendMessage({ type: "GET_LEADS" }, async (resp) => {
          const { fb_snoozed = {} } = await chrome.storage.local.get({ fb_snoozed: {} }).catch(() => ({ fb_snoozed: {} }));
          const currentLeadId = secondTouch.leadId || lead?.id;
          const queue = window.FBQueue.buildQueue(resp?.leads || [], { channel: "ig", snoozed: fb_snoozed });
          const nextLead = queue.find((l) => l.id !== currentLeadId);
          if (nextLead) {
            const nextUrl = nextLead.ig_profile_url || `https://www.instagram.com/${nextLead.ig_username}/`;
            const nextBtn = document.createElement("button");
            nextBtn.textContent = `Next → @${nextLead.ig_username || nextLead.name}`;
            nextBtn.style.cssText = "width:100%;margin-top:6px;background:#161616;border:1px solid #3b82f6;border-radius:7px;color:#93c5fd;font-size:11px;font-weight:600;padding:7px;cursor:pointer";
            nextBtn.addEventListener("click", () => { window.location.href = nextUrl; });
            b.appendChild(nextBtn);
          }
        });
      } : null;
      showDmPreview(card, b, username, suggestion?.text || null, { channel: autoDm, lead, crossChannelIntro, afterSend: afterSendFn });
    }

    card.appendChild(b);
  }

  function renderError(username, dashboardUrl) {
    const card = buildCard();
    renderHeader(card, username);
    const b = document.createElement("div");
    b.style.cssText = "padding:12px 14px";
    b.innerHTML = `
      <p style="margin:0 0 8px;color:#888;font-size:12px">Research failed. Open dashboard to retry.</p>
      <a href="${dashboardUrl}" target="_blank" style="display:block;text-align:center;color:#FF3A69;font-size:12px;font-weight:600;text-decoration:none">Open Dashboard →</a>
    `;
    card.appendChild(b);
  }

  function stageColor(stage) {
    const c = { "New":"#64748b","Warming":"#f59e0b","DM Sent":"#3b82f6","Replied":"#8b5cf6","Qualifying":"#06b6d4","Call Offered":"#10b981","Booked":"#22c55e","Closed":"#475569","DQ":"#ef4444" };
    return c[stage] || "#64748b";
  }

  async function fetchRecentMessages(leadId, dashboardUrl) {
    try {
      const res = await fetch(`${dashboardUrl}/api/messages?lead_id=${encodeURIComponent(leadId)}&limit=4`, { headers: await repAuthHeader() });
      if (!res.ok) return [];
      const { messages } = await res.json();
      return messages ?? [];
    } catch { return []; }
  }

  function renderComplete(username, lead, dashboardUrl, calendarUrl, autoDm, secondTouch, crossChannelIntro) {
    const card = buildCard();
    renderHeader(card, username);
    const b = document.createElement("div");
    b.style.cssText = "padding:10px 14px 12px";
    card.appendChild(b);

    const cache = lead.research_cache || {};
    const fitScore = typeof cache.fitScore === "number" ? cache.fitScore : null;
    const stack = Array.isArray(cache.stackDetected) ? cache.stackDetected : [];
    const opener = typeof cache.suggestedOpener === "string" ? cache.suggestedOpener : null;
    const fitReason = typeof cache.fitReason === "string" ? cache.fitReason : null;
    const estimatedGmv = typeof cache.estimatedGmv === "number" ? cache.estimatedGmv : null;

    const sfStatus = lead.sf_status || "none";
    const sfScore  = typeof lead.sf_confidence_score === "number" ? lead.sf_confidence_score : 0;
    const sfName   = lead.sf_account_name || null;
    const sfConf   = sfScore >= 55 ? "✓" : sfScore >= 25 ? "~" : "?";

    if (lead.stage === "DM Sent") {
      const repliedBtn = document.createElement("button");
      repliedBtn.style.cssText = "background:#1e1a2e;border:1px solid #4c3a8a;border-radius:8px;padding:7px 10px;margin-bottom:10px;display:flex;align-items:center;gap:8px;width:100%;cursor:pointer";
      repliedBtn.innerHTML = `<span style="font-size:14px">💬</span><div style="text-align:left"><span style="color:#c4b5fd;font-size:12px;font-weight:700">They Replied!</span><span style="color:#a78bfa;font-size:11px;margin-left:6px">Mark as Replied →</span></div>`;
      repliedBtn.addEventListener("click", async () => {
        repliedBtn.disabled = true;
        repliedBtn.style.opacity = "0.6";
        chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { stage: "Replied" } }).catch(() => {});
        setTimeout(() => updateCardForProfile(), 500);
      });
      b.appendChild(repliedBtn);
    }

    if (lead.stage === "Replied") {
      const replied = document.createElement("button");
      replied.style.cssText = "background:#2d1a4a;border:1px solid #6d28d9;border-radius:8px;padding:7px 10px;margin-bottom:10px;display:flex;align-items:center;gap:8px;width:100%;cursor:pointer";
      replied.innerHTML = `<span style="font-size:14px">💬</span><div style="text-align:left"><span style="color:#c4b5fd;font-size:12px;font-weight:700">Replied!</span><span style="color:#a78bfa;font-size:11px;margin-left:6px">Move to Qualifying →</span></div>`;
      replied.addEventListener("click", async () => {
        replied.disabled = true;
        replied.style.opacity = "0.6";
        chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { stage: "Qualifying" } }).catch(() => {});
        setTimeout(() => updateCardForProfile(), 500);
      });
      b.appendChild(replied);
    }

    if (sfStatus === "customer") {
      const banner = document.createElement("div");
      banner.style.cssText = "background:#0d2b0d;border:1px solid #166534;border-radius:8px;padding:7px 10px;margin-bottom:10px";
      const nameHtml = sfName ? `<span style="color:#86efac;font-size:11px">${sfName}</span> · ` : "";
      banner.innerHTML = `<span style="color:#4ade80;font-size:12px;font-weight:600">${sfConf} Existing FanBasis Customer</span><br>${nameHtml}<span style="color:#86efac;font-size:11px">Use expansion play · ${sfScore}/100 confidence</span>`;
      b.appendChild(banner);
    } else if (sfStatus === "inactive") {
      const banner = document.createElement("div");
      banner.style.cssText = "background:#2d1a00;border:1px solid #92400e;border-radius:8px;padding:7px 10px;margin-bottom:10px";
      const nameHtml = sfName ? `<span style="color:#fde68a;font-size:11px">${sfName}</span> · ` : "";
      banner.innerHTML = `<span style="color:#fbbf24;font-size:12px;font-weight:600">⚡ Inactive Account</span><br>${nameHtml}<span style="color:#fde68a;font-size:11px">Was a customer · win-back opportunity · ${sfScore}/100</span>`;
      b.appendChild(banner);
    } else if (sfStatus === "prospect") {
      const banner = document.createElement("div");
      banner.style.cssText = "background:#0f1f3d;border:1px solid #1d4ed8;border-radius:8px;padding:7px 10px;margin-bottom:10px";
      const nameHtml = sfName ? `<span style="color:#bfdbfe;font-size:11px">${sfName}</span> · ` : "";
      banner.innerHTML = `<span style="color:#60a5fa;font-size:12px;font-weight:600">◎ In Salesforce</span><br>${nameHtml}<span style="color:#bfdbfe;font-size:11px">In SF but not yet a customer · ${sfScore}/100</span>`;
      b.appendChild(banner);
    }

    if (fitScore !== null || (estimatedGmv !== null && estimatedGmv > 0)) {
      const color = fitScore !== null ? fitColor(fitScore) : "#555";
      const infoRow = document.createElement("div");
      infoRow.style.cssText = "display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:8px";
      if (fitScore !== null) {
        infoRow.innerHTML += `<span style="font-size:11px;font-weight:700;color:${color};background:${color}18;border:1px solid ${color}30;padding:2px 9px;border-radius:10px">${fitScore} · ${fitLabel(fitScore)}</span>`;
      }
      if (estimatedGmv !== null && estimatedGmv > 0) {
        infoRow.innerHTML += `<span style="font-size:11px;color:#888;font-weight:600">$${estimatedGmv.toLocaleString()}/mo</span>`;
      }
      b.appendChild(infoRow);
    }

    if (stack.length > 0) {
      const stackRow = document.createElement("div");
      stackRow.style.cssText = "display:flex;flex-wrap:wrap;gap:4px;margin-bottom:10px";
      stackRow.innerHTML = stack.map(s =>
        `<span style="background:#1a1a1a;border:1px solid #2a2a2a;color:#888;font-size:10px;padding:2px 7px;border-radius:10px">${s}</span>`
      ).join("");
      b.appendChild(stackRow);
    }

    if (opener) {
      const openerBox = document.createElement("div");
      openerBox.style.cssText = "background:#161616;border:1px solid #222;border-radius:8px;padding:9px 10px;margin-bottom:10px;position:relative";
      openerBox.innerHTML = `
        <div style="font-size:9px;color:#444;text-transform:uppercase;letter-spacing:.5px;margin-bottom:5px">AI Suggested Opener</div>
        <p style="margin:0;color:#ccc;font-size:12px;line-height:1.5;padding-right:46px">${opener}</p>
        <button id="fb-copy-opener" style="position:absolute;top:8px;right:8px;background:#FF3A69;border:none;border-radius:5px;color:#fff;font-size:10px;font-weight:600;padding:3px 8px;cursor:pointer">Copy</button>
      `;
      b.appendChild(openerBox);
      document.getElementById("fb-copy-opener").addEventListener("click", function () {
        navigator.clipboard.writeText(opener).then(() => {
          this.textContent = "✓";
          setTimeout(() => { this.textContent = "Copy"; }, 1500);
        });
      });
    }

    if (fitReason) {
      const reasonDetails = document.createElement("details");
      reasonDetails.style.cssText = "margin-bottom:8px";
      const reasonSummary = document.createElement("summary");
      reasonSummary.style.cssText = "font-size:10px;color:#3a3a50;cursor:pointer;user-select:none;letter-spacing:.3px;list-style:none";
      reasonSummary.textContent = "Why this score?";
      const reasonText = document.createElement("p");
      reasonText.style.cssText = "margin:4px 0 0;color:#555;font-size:11px;line-height:1.5";
      reasonText.textContent = fitReason;
      reasonDetails.appendChild(reasonSummary);
      reasonDetails.appendChild(reasonText);
      b.appendChild(reasonDetails);
    }

    const outreachChannels = lead.outreach_channels || {};
    renderChannelTracker(b, outreachChannels);

    // Touch chips — tap to mark each account's DM done without the full wizard
    let fbChipDone = !!(outreachChannels.ig_fanbasis?.sent);
    let persChipDone = !!(outreachChannels.ig_personal?.sent);
    const touchChips = document.createElement("div");
    touchChips.style.cssText = "display:flex;gap:6px;margin-bottom:8px";
    const fbChip = document.createElement("button");
    fbChip.textContent = (fbChipDone ? "✓" : "○") + " FB";
    fbChip.style.cssText = `flex:1;background:${fbChipDone ? "#0d2b0d" : "#161616"};border:1px solid ${fbChipDone ? "#166534" : "#2a2a35"};border-radius:6px;color:${fbChipDone ? "#4ade80" : "#555"};font-size:11px;font-weight:600;padding:5px;cursor:pointer`;
    fbChip.addEventListener("click", () => {
      fbChipDone = !fbChipDone;
      fbChip.textContent = (fbChipDone ? "✓" : "○") + " FB";
      fbChip.style.background = fbChipDone ? "#0d2b0d" : "#161616";
      fbChip.style.borderColor = fbChipDone ? "#166534" : "#2a2a35";
      fbChip.style.color = fbChipDone ? "#4ade80" : "#555";
      if (fbChipDone) chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { outreach_channels: { ...outreachChannels, ig_fanbasis: { sent: true, sentAt: Date.now() } } } }).catch(() => {});
    });
    const persChip = document.createElement("button");
    persChip.textContent = (persChipDone ? "✓" : "○") + " Pers.";
    persChip.style.cssText = `flex:1;background:${persChipDone ? "#0d2b0d" : "#161616"};border:1px solid ${persChipDone ? "#166534" : "#2a2a35"};border-radius:6px;color:${persChipDone ? "#4ade80" : "#555"};font-size:11px;font-weight:600;padding:5px;cursor:pointer`;
    persChip.addEventListener("click", () => {
      persChipDone = !persChipDone;
      persChip.textContent = (persChipDone ? "✓" : "○") + " Pers.";
      persChip.style.background = persChipDone ? "#0d2b0d" : "#161616";
      persChip.style.borderColor = persChipDone ? "#166534" : "#2a2a35";
      persChip.style.color = persChipDone ? "#4ade80" : "#555";
      if (persChipDone) chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { outreach_channels: { ...outreachChannels, ig_personal: { sent: true, sentAt: Date.now() } } } }).catch(() => {});
    });
    touchChips.appendChild(fbChip);
    touchChips.appendChild(persChip);
    b.appendChild(touchChips);

    // Send DM (full two-touch wizard) — primary CTA
    renderSmartDmBtn(card, b, username, lead, opener || null, dashboardUrl);

    // DM Sent — full-width quick-mark, promoted to primary
    const dmSentBtn = document.createElement("button");
    dmSentBtn.textContent = "✓ DM Sent";
    dmSentBtn.style.cssText = "width:100%;background:#0d2b0d;border:1px solid #166534;border-radius:8px;color:#4ade80;font-size:12px;font-weight:600;padding:8px;cursor:pointer;margin-bottom:6px";
    dmSentBtn.addEventListener("click", async () => {
      dmSentBtn.textContent = "Saving…"; dmSentBtn.disabled = true;
      const due = new Date(Date.now() + 3 * 24 * 3600000).toISOString();
      const r = await chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { stage: "DM Sent", last_contact_at: new Date().toISOString(), due_at: due } }).catch(() => null);
      if (r?.ok === false) { dmSentBtn.textContent = "✓ DM Sent"; dmSentBtn.disabled = false; return; }
      navigateToNextLead(b, username, lead.id, dashboardUrl);
    });
    b.appendChild(dmSentBtn);

    // Secondary actions row
    const actions = document.createElement("div");
    actions.style.cssText = "display:flex;gap:5px";

    const bookCalBtn = document.createElement("button");
    bookCalBtn.textContent = "📅 Book a Call";
    bookCalBtn.style.cssText = "flex:1;background:#0f2540;border:1px solid #1d4ed8;border-radius:6px;color:#93c5fd;font-size:11px;font-weight:600;padding:5px;cursor:pointer";
    bookCalBtn.addEventListener("click", async () => {
      if (bookCalBtn.dataset.connect) {
        // Second click after "Connect calendar" — re-sign-in upgrades the Google scope
        delete bookCalBtn.dataset.connect;
        bookCalBtn.textContent = "📅 Book a Call";
        chrome.runtime.sendMessage({ type: "SIGN_IN" }).catch(() => {});
        return;
      }
      bookCalBtn.textContent = "Checking…"; bookCalBtn.disabled = true;
      const result = await chrome.runtime.sendMessage({ type: "GET_CALENDAR_SLOTS" }).catch(() => null);
      bookCalBtn.textContent = "📅 Book a Call"; bookCalBtn.disabled = false;
      if (result?.ok && result.slots && result.slots.length) {
        showSlotPicker(card, b, username, lead, dashboardUrl, result.slots, result.slotMins);
      } else if (result?.needsCalendar || result?.needsSignIn) {
        bookCalBtn.dataset.connect = "1";
        bookCalBtn.textContent = "🔗 Connect calendar";
      } else {
        const calScript = calendarUrl
          ? `Hey [Name] — happy to walk you through the dashboard, no pitch, just 15 min to show you what it looks like with your numbers.\n\nHere's my link: ${calendarUrl} — grab whatever works and I'll send context beforehand.`
          : `Hey [Name] — happy to walk you through the dashboard, no pitch, just 15 min to show you what it looks like with your numbers. lmk if that makes sense.`;
        showDmPreview(card, b, username, null, { lead, leadId: lead.id, channel: "ig_fanbasis", dashboardUrl, bookingScript: calScript, afterSend: () => {
          chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { stage: "Call Offered" } }).catch(() => {});
          setTimeout(() => updateCardForProfile(), 500);
        }});
      }
    });
    actions.appendChild(bookCalBtn);

    const vmScripts = (typeof SCRIPTS !== "undefined" && SCRIPTS["Voice Messages"]) || [];
    if (vmScripts.length) {
      let vmIdx = 0;
      const vmBtn = document.createElement("button");
      vmBtn.textContent = "🎙 Copy VM";
      vmBtn.style.cssText = "flex:1;background:#161616;border:1px solid #252525;border-radius:6px;color:#94a3b8;font-size:11px;font-weight:600;padding:5px;cursor:pointer";
      vmBtn.title = vmScripts[vmIdx].text;
      vmBtn.addEventListener("click", () => {
        navigator.clipboard.writeText(vmScripts[vmIdx].text).then(() => {
          vmBtn.textContent = "✓ Copied";
          vmIdx = (vmIdx + 1) % vmScripts.length;
          setTimeout(() => { vmBtn.textContent = `🎙 VM ${vmIdx + 1}/${vmScripts.length}`; vmBtn.title = vmScripts[vmIdx].text; }, 1200);
        });
      });
      actions.appendChild(vmBtn);
    }

    const dqBtn = document.createElement("button");
    dqBtn.textContent = "✗ DQ";
    dqBtn.style.cssText = "flex:1;background:#161616;border:1px solid #7f1d1d;border-radius:6px;color:#ef4444;font-size:11px;font-weight:600;padding:5px;cursor:pointer";
    dqBtn.addEventListener("click", () => {
      if (dqBtn.dataset.undoing) {
        clearTimeout(Number(dqBtn.dataset.timer));
        delete dqBtn.dataset.undoing;
        dqBtn.textContent = "✗ DQ";
        dqBtn.style.cssText = "flex:1;background:#161616;border:1px solid #7f1d1d;border-radius:6px;color:#ef4444;font-size:11px;font-weight:600;padding:5px;cursor:pointer";
        return;
      }
      dqBtn.dataset.undoing = "1";
      dqBtn.textContent = "↩ Undo";
      dqBtn.style.cssText = "flex:1;background:#1a1a1a;border:1px solid #444;border-radius:6px;color:#888;font-size:11px;font-weight:600;padding:5px;cursor:pointer";
      dqBtn.dataset.timer = setTimeout(async () => {
        delete dqBtn.dataset.undoing;
        dqBtn.textContent = "DQ'd"; dqBtn.disabled = true;
        const r = await chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { stage: "DQ" } }).catch(() => null);
        if (r?.ok === false) { dqBtn.textContent = "✗ DQ"; dqBtn.disabled = false; dqBtn.style.cssText = "flex:1;background:#161616;border:1px solid #7f1d1d;border-radius:6px;color:#ef4444;font-size:11px;font-weight:600;padding:5px;cursor:pointer"; return; }
        navigateToNextLead(b, username, lead.id, dashboardUrl);
      }, 4000);
    });
    actions.appendChild(dqBtn);

    if (actions.children.length) b.appendChild(actions);

    // Stage dropdown + View link — compact, below action buttons
    const sc = stageColor(lead.stage);
    const stageFooter = document.createElement("div");
    stageFooter.style.cssText = "display:flex;align-items:center;gap:8px;margin-top:6px";
    const stageOptions = STAGES.map(s =>
      `<option value="${s}"${lead.stage === s ? " selected" : ""}>${s}</option>`
    ).join("");
    stageFooter.innerHTML = `
      <select id="fb-stage" style="flex:1;background:#1a1a1a;border:1px solid ${sc}55;border-radius:7px;color:${sc};font-size:12px;font-weight:600;padding:5px 8px;cursor:pointer">${stageOptions}</select>
      <a href="${dashboardUrl}/leads/${lead.id}" target="_blank" style="color:#FF3A69;font-size:11px;text-decoration:none;font-weight:600;white-space:nowrap;padding:5px">View →</a>
    `;
    b.appendChild(stageFooter);

    document.getElementById("fb-stage").addEventListener("change", async function () {
      this.style.color = stageColor(this.value);
      this.style.borderColor = stageColor(this.value) + "55";
      chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { stage: this.value } }).catch(() => {});
    });

    const chatsToggle = document.createElement("details");
    chatsToggle.style.cssText = "margin-top:8px;border-top:1px solid #1e1e2a;padding-top:6px";
    const chatsSummary = document.createElement("summary");
    chatsSummary.style.cssText = "font-size:10px;color:#475569;cursor:pointer;user-select:none;list-style:none;letter-spacing:.3px;text-transform:uppercase";
    chatsSummary.textContent = "💬 Recent Chats";
    const chatsContent = document.createElement("div");
    chatsContent.style.cssText = "margin-top:6px";
    chatsContent.innerHTML = `<div style="color:#333;font-size:11px;padding:4px 0">Loading…</div>`;

    let chatsFetched = false;
    chatsToggle.addEventListener("toggle", async () => {
      if (!chatsToggle.open || chatsFetched) return;
      chatsFetched = true;
      const msgs = await fetchRecentMessages(lead.id, dashboardUrl);
      if (!msgs.length) {
        chatsContent.innerHTML = `<div style="color:#333;font-size:11px;padding:4px 0">No messages logged yet.</div>`;
        return;
      }
      chatsContent.innerHTML = msgs.map((m) => {
        const dir = m.direction === "inbound" ? "←" : "→";
        const ch = { ig: "📸", instagram: "📸", email: "✉️", linkedin: "💼", sms: "💬" }[(m.channel || "").toLowerCase()] || "💬";
        const when = m.created_at ? new Date(m.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" }) : "";
        const snippet = (m.body || "").slice(0, 80) + ((m.body || "").length > 80 ? "…" : "");
        return `
          <div style="padding:5px 0;border-bottom:1px solid #1a1a1a;display:flex;gap:6px;align-items:flex-start">
            <span style="font-size:9px;color:${m.direction === "inbound" ? "#8b5cf6" : "#3b82f6"};flex-shrink:0;margin-top:1px">${dir} ${ch}</span>
            <div style="flex:1;min-width:0">
              <span style="font-size:11px;color:#94a3b8;line-height:1.4;display:block">${snippet || "<em style='color:#333'>no preview</em>"}</span>
              <span style="font-size:9px;color:#333">${when}</span>
            </div>
          </div>
        `;
      }).join("");
    });

    chatsToggle.appendChild(chatsSummary);
    chatsToggle.appendChild(chatsContent);
    b.appendChild(chatsToggle);

    if (!autoDm) navigateToNextLead(b, username, lead?.id, dashboardUrl);

    if (autoDm) {
      const outreachChannels2 = lead.outreach_channels || {};
      const afterSendFn = secondTouch ? () => {
        chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: secondTouch.leadId, updates: { stage: "DM Sent", last_contact_at: new Date().toISOString(), due_at: new Date(Date.now() + 3*24*3600000).toISOString() } }).catch(() => {});
        const done = document.createElement("div");
        done.style.cssText = "margin-top:8px;padding:8px 10px;background:#0d2b0d;border:1px solid #166534;border-radius:7px;color:#4ade80;font-size:11px;font-weight:600;text-align:center";
        done.textContent = "✓ Both channels done — DM Sent!";
        b.appendChild(done);
        // Next lead button — same logic as completeBothSends
        chrome.runtime.sendMessage({ type: "GET_LEADS" }, async (resp) => {
          const { fb_snoozed = {} } = await chrome.storage.local.get({ fb_snoozed: {} }).catch(() => ({ fb_snoozed: {} }));
          const currentLeadId = secondTouch.leadId || lead?.id;
          const queue = window.FBQueue.buildQueue(resp?.leads || [], { channel: "ig", snoozed: fb_snoozed });
          const nextLead = queue.find((l) => l.id !== currentLeadId);
          if (nextLead) {
            const nextUrl = nextLead.ig_profile_url || `https://www.instagram.com/${nextLead.ig_username}/`;
            const nextBtn = document.createElement("button");
            nextBtn.textContent = `Next → @${nextLead.ig_username || nextLead.name}`;
            nextBtn.style.cssText = "width:100%;margin-top:6px;background:#161616;border:1px solid #3b82f6;border-radius:7px;color:#93c5fd;font-size:11px;font-weight:600;padding:7px;cursor:pointer";
            nextBtn.addEventListener("click", () => { window.location.href = nextUrl; });
            b.appendChild(nextBtn);
          }
        });
      } : null;
      showDmPreview(card, b, username, opener || null, { channel: autoDm, leadId: lead.id, outreachChannels: outreachChannels2, dashboardUrl, lead, crossChannelIntro, afterSend: afterSendFn });
    }
  }

  // ── Poll while pending ──────────────────────────────────────────────────────

  function startPoll(username, dashboardUrl, igSecret, calendarUrl, autoDm, secondTouch, crossChannelIntro) {
    clearInterval(pollTimer);
    let attempts = 0;
    pollTimer = setInterval(async () => {
      if (++attempts > 36) { clearInterval(pollTimer); return; } // max 6 min
      const lead = await fetchLead(username, dashboardUrl);
      if (!lead) return;
      if (lead.research_status === "complete") {
        clearInterval(pollTimer);
        renderComplete(username, lead, dashboardUrl, calendarUrl, autoDm, secondTouch, crossChannelIntro);
      } else if (lead.research_status === "error") {
        clearInterval(pollTimer);
        renderError(username, dashboardUrl);
      }
    }, 10000);
  }

  // ── Main entry: called on every URL change ──────────────────────────────────

  async function updateCardForProfile() {
    // ── Pending DM from account switch ──────────────────────────────────────
    // Layer C: check localStorage first, fall back to chrome.storage.local backup.
    // IG's account switch does a full-page reload which can clear localStorage in
    // some browser configurations; the backup ensures the pending DM survives.
    let pending = getPendingDm();
    if (!pending) {
      const bk = await new Promise(r => chrome.storage.local.get({ fb_pendingDm_backup: null }, r));
      const backup = bk.fb_pendingDm_backup;
      if (backup && backup.ts && Date.now() - backup.ts < 600000) {
        pending = backup;
        console.log("[FanBasis] pendingDm restored from backup:", pending);
        try { localStorage.setItem(FB_PENDING_KEY, JSON.stringify(pending)); } catch {}
      } else if (backup) {
        chrome.storage.local.remove("fb_pendingDm_backup").catch(() => {});
      }
    }
    if (pending) console.log("[FanBasis] pendingDm:", pending);

    let autoDm = null;
    let autoDmSecondTouch = null;
    let autoDmCrossChannelIntro = null;
    if (pending && Date.now() - pending.ts < 600000) { // 10-min expiry
      const currentUser = extractUsernameFromUrl();
      if (currentUser !== pending.profile) {
        // Not on the right profile yet — navigate there but KEEP pending in localStorage
        // so it's available when we arrive. Do NOT clearPendingDm here.
        window.location.href = `https://www.instagram.com/${pending.profile}/`;
        return;
      }
      // We're on the right profile — consume the pending and proceed
      autoDm = pending.channel;
      autoDmSecondTouch = pending.secondTouch || null;
      autoDmCrossChannelIntro = pending.crossChannelIntro || null;
      clearPendingDm();
    }
    // ────────────────────────────────────────────────────────────────────────

    const username = extractUsernameFromUrl();

    if (!username) {
      removeCard();
      return;
    }

    if (dismissedFor === username) return;

    const { dashboardUrl, igSecret, calendarUrl } = await getSettings();

    const _bio = document.querySelector('meta[name="description"]')?.content ?? "";
    const _displayName = document.querySelector("h1")?.textContent?.trim() ||
      document.querySelector("h2")?.textContent?.trim() || username;
    sendProfileContext(username, _displayName, _bio, parseFollowerCount(), detectStack(_bio));

    flushRetryQueue(dashboardUrl);

    renderLoading(username);

    const lead = await fetchLead(username, dashboardUrl);

    // Persist for sidepanel cold-open recovery (fires even if sidepanel isn't open yet)
    chrome.storage.local.set({ lastIgEvent: { type: "FB_PROFILE_ACTIVE", username, ts: Date.now() } }).catch(() => {});
    chrome.runtime.sendMessage({ type: "FB_PROFILE_ACTIVE", username }).catch(() => {});

    if (!lead) {
      renderUnsaved(username, dashboardUrl, igSecret, calendarUrl, autoDm, autoDmCrossChannelIntro);
    } else if (lead.research_status === "complete") {
      renderComplete(username, lead, dashboardUrl, calendarUrl, autoDm, autoDmSecondTouch, autoDmCrossChannelIntro);
    } else if (lead.research_status === "error") {
      renderError(username, dashboardUrl);
    } else {
      renderSaved(username, dashboardUrl, lead, calendarUrl, autoDm, autoDmSecondTouch, autoDmCrossChannelIntro);
      if (!autoDm) startPoll(username, dashboardUrl, igSecret, calendarUrl, autoDm, autoDmSecondTouch, autoDmCrossChannelIntro);
    }
  }

  // ── SPA navigation watcher ──────────────────────────────────────────────────

  let lastUrl = location.href;
  function handleUrlChange() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    dismissedFor = null;
    observeProfileHeader();
    updateCardForProfile().catch(e => console.error("[FanBasis] card error:", e));
    // Re-trigger page-interceptor account detection after each SPA navigation
    // (page-interceptor.js listens for this to re-run detectViewerFromDom)
    document.dispatchEvent(new CustomEvent("ig_viewer_check", { bubbles: true, composed: true }));
  }

  // Fast path: Navigation API (Chrome 102+) — fires near-instantly on SPA navigation
  if (window.navigation) {
    window.navigation.addEventListener("navigate", () => setTimeout(handleUrlChange, 50));
  }
  // Fallback: poll for browsers without Navigation API
  setInterval(handleUrlChange, 800);

  observeProfileHeader();
  updateCardForProfile().catch(e => console.error("[FanBasis] card error:", e));

  try {
    if (localStorage.getItem("fb_auto_dm_confirm")) {
      localStorage.removeItem("fb_auto_dm_confirm");
      autoConfirmIgDialog();
    }
  } catch { /* ignore */ }

  chrome.runtime.onMessage.addListener((msg) => {
    if (msg.type === "CLICK_DM_BTN") openIgDm(msg.username || extractUsernameFromUrl());
    if (msg.type === "TRIGGER_SAVE") {
      getSettings().then(({ dashboardUrl, igSecret }) => {
        const username = extractUsernameFromUrl();
        if (username) saveLead(username, dashboardUrl, igSecret).catch(() => {});
      });
    }
    if (msg.type === "LEAD_UPDATED") {
      updateCardForProfile().catch(e => console.error("[FanBasis] card error:", e));
      refreshTrackedHandles(); // keep the reply-relay prefilter current
    }
  });

})();
