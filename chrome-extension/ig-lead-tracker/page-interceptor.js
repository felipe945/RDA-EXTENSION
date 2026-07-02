// Injected into the PAGE world to intercept Instagram's fetch calls
// Must be in web_accessible_resources and injected via instagram.js

(function () {
  if (window.__igInterceptorInstalled) return;
  window.__igInterceptorInstalled = true;

  const origFetch = window.fetch;

  // Contract A: ig_dm_sent means a real outbound send. IG also POSTs under
  // /direct_v2/threads/ when a thread is opened or marked seen — only the
  // broadcast endpoint is an actual send, so anything else must not dispatch.
  function isDmSendUrl(url) {
    return /\/direct_v2\/threads\/broadcast\//.test(url);
  }

  // Contract R1: ig_reply — inbound DM detection off inbox/thread READS.
  // broadcast is the send endpoint (Contract A) and must never be treated as a read.
  function isDmReadUrl(url) {
    if (!url || isDmSendUrl(url)) return false;
    return /\/direct_v2\/inbox\//.test(url) || /\/direct_v2\/threads\/\d+\//.test(url);
  }

  // Allowlist of item_types that count as a real inbound message. Reactions,
  // likes, seen markers, and action_log entries land in items[] with the
  // prospect's user_id — blocklisting would let unknown types flip leads to
  // Replied, so anything not listed here is dropped.
  const REAL_MESSAGE_TYPES = new Set([
    "text", "media", "clip", "voice_media", "raven_media",
    "animated_media", "link", "share", "story_share",
  ]);

  function dmItemText(item) {
    if (typeof item.text === "string" && item.text) return item.text;
    if (item.item_type === "voice_media") return "[voice]";
    if (item.item_type === "link") return (item.link && item.link.text) || "[link]";
    return "[media]";
  }

  function handleDmResponse(data) {
    try {
      if (!data) return;
      const threads = Array.isArray(data.inbox?.threads)
        ? data.inbox.threads
        : data.thread ? [data.thread] : [];
      if (!threads.length) return;

      // Viewer id from the response itself; per-thread viewer_id wins.
      const topViewerId =
        data.viewer?.pk ?? data.viewer?.pk_id ?? data.viewer?.id ??
        data.inbox?.viewer?.pk ?? data.viewer_id ?? null;

      for (const thread of threads) {
        if (!thread) continue;
        const viewerId = thread.viewer_id ?? topViewerId;
        // Shared-account landmine: with viewerId undefined, user_id !== viewerId
        // is always true and reps' own outbound DMs would emit as replies.
        if (viewerId == null) continue;
        const vid = String(viewerId);

        const threadId = String(thread.thread_id ?? thread.thread_v2_id ?? "");
        if (!threadId) continue;
        const users = Array.isArray(thread.users) ? thread.users : [];
        const items = Array.isArray(thread.items) ? thread.items : [];

        // Items arrive newest-first; dispatch oldest→newest so a burst of
        // replies lands in natural order downstream. T2 dedups by itemId.
        for (let i = items.length - 1; i >= 0; i--) {
          const item = items[i];
          if (!item) continue;
          if (item.user_id == null || String(item.user_id) === vid) continue;
          if (!REAL_MESSAGE_TYPES.has(item.item_type)) continue;
          const itemId = item.item_id != null ? String(item.item_id) : "";
          if (!itemId) continue;

          const sender =
            users.find((u) => u && String(u.pk ?? u.pk_id ?? u.id) === String(item.user_id)) ||
            users.find((u) => u && String(u.pk ?? u.pk_id ?? u.id) !== vid);
          const username = String(sender?.username || "").toLowerCase().replace(/^@/, "");
          if (!username) continue;

          document.dispatchEvent(
            new CustomEvent("ig_reply", {
              detail: {
                threadId,
                username,
                itemId,
                text: dmItemText(item),
                itemType: String(item.item_type || ""),
              },
              bubbles: true, composed: true,
            })
          );
        }
      }
    } catch {}
  }

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) ? input.url : "";
    const method = ((init && init.method) || (input && input.method) || "GET").toUpperCase();

    if (method === "POST") {
      // Follow / friend request
      if (
        /\/friendships\/.*\/(follow|create)/.test(url) ||
        /\/friendships\/create/.test(url)
      ) {
        const userId = (url.match(/\/friendships\/(\d+)/) || [])[1] || "";
        document.dispatchEvent(
          new CustomEvent("ig_action", {
            detail: { type: "follow", userId },
            bubbles: true, composed: true,
          })
        );
      }
      // Like
      else if (/\/media\/.*\/like/.test(url)) {
        document.dispatchEvent(
          new CustomEvent("ig_action", {
            detail: { type: "like", userId: "", postUrl: window.location.href },
            bubbles: true, composed: true,
          })
        );
      }
      // DM send detection — broadcast endpoint only (Contract A)
      else if (isDmSendUrl(url)) {
        document.dispatchEvent(new CustomEvent("ig_dm_sent", { bubbles: true, composed: true }));
      }
    }

    // After any fetch — try to read viewer from GraphQL/API response first, then fall back to DOM
    const p = origFetch.apply(this, arguments);
    p.then(async (res) => {
      // DM inbox/thread reads (Contract R1) — runs before and independent of
      // the viewer block below, whose early return would otherwise skip it.
      if (method === "GET" && isDmReadUrl(url)) {
        try {
          const dmData = await res.clone().json().catch(() => null);
          if (dmData) handleDmResponse(dmData);
        } catch {}
      }
      try {
        if (url.includes("graphql") || url.includes("api/v1")) {
          const clone = res.clone();
          const data = await clone.json().catch(() => null);
          if (data) {
            const u =
              data?.data?.viewer?.username ||
              data?.viewer?.username ||
              data?.user?.username ||
              data?.data?.user?.username ||
              data?.config?.viewer?.username;
            if (u) { emitViewer(u); return; }
          }
        }
      } catch {}
      detectViewerFromDom();
    }).catch(() => { detectViewerFromDom(); });
    return p;
  };

  // ── XHR interception for viewer detection ──────────────────────────────────
  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this._url = url;
    this._method = (method || "GET").toUpperCase();
    return origOpen.apply(this, [method, url, ...rest]);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      // DM inbox/thread reads (Contract R1) — /direct_v2/ is not in the
      // viewer allowlist below, so it needs its own branch.
      try {
        if (this._method === "GET" && isDmReadUrl(this._url)) {
          handleDmResponse(JSON.parse(this.responseText));
        }
      } catch {}
      try {
        if (
          this._url &&
          (this._url.includes("api/v1/accounts/current_user") ||
            this._url.includes("graphql") ||
            this._url.includes("api/v1/feed"))
        ) {
          const data = JSON.parse(this.responseText);
          const username =
            data?.user?.username ||
            data?.data?.viewer?.username ||
            data?.viewer?.username ||
            data?.data?.user?.username ||
            data?.graphql?.user?.username;
          if (username) emitViewer(username);
        }
      } catch {}
      if (this._url && this._method === "POST" && isDmSendUrl(this._url)) {
        document.dispatchEvent(new CustomEvent("ig_dm_sent", { bubbles: true, composed: true }));
      }
    });
    return origSend.apply(this, args);
  };

  // ── DOM fallback: nav profile link is always present ─────────────────────
  const SKIP_HANDLES = new Set([
    "explore","direct","reel","reels","stories","p","accounts","tv","ar",
    "login","challenge","home","inbox","notifications","create","audio",
    "directinbox","about","privacy","help","settings","your_activity",
  ]);

  function emitViewer(username) {
    document.dispatchEvent(
      new CustomEvent("ig_viewer", { detail: { username }, bubbles: true, composed: true })
    );
  }

  function detectViewerFromDom() {
    // Strategy 1: window._sharedData (works on some IG layouts)
    try {
      const u = window._sharedData?.config?.viewer?.username;
      if (u) { emitViewer(u); return; }
    } catch {}

    // Strategy 2: aria-label="Profile" — IG consistently sets this on current user's nav link
    try {
      const ariaLink = document.querySelector(
        'a[aria-label="Profile"], a[aria-label="profile"],' +
        '[aria-label="Profile"] a[href], [aria-label="profile"] a[href]'
      );
      if (ariaLink) {
        const href = (ariaLink.getAttribute("href") || "");
        const m = href.match(/^\/([a-zA-Z0-9._]{1,30})\/?$/);
        if (m && !SKIP_HANDLES.has(m[1].toLowerCase())) { emitViewer(m[1]); return; }
      }
    } catch {}

    // Strategy 3: nav/sidebar img with alt text that looks like a username
    try {
      const navImgs = document.querySelectorAll(
        "nav img[alt], header img[alt], [role='navigation'] img[alt], aside img[alt]"
      );
      for (const img of navImgs) {
        const alt = (img.getAttribute("alt") || "").trim();
        if (/^[a-zA-Z0-9._]{2,30}$/.test(alt) && !SKIP_HANDLES.has(alt.toLowerCase())) {
          emitViewer(alt.toLowerCase()); return;
        }
      }
    } catch {}

    // Strategy 4: nav/header links with single-segment href (original approach)
    try {
      const navLinks = document.querySelectorAll(
        "nav a[href], header a[href], [role='navigation'] a[href]"
      );
      for (const link of navLinks) {
        const href = link.getAttribute("href") || "";
        const m = href.match(/^\/([a-zA-Z0-9._]{1,30})\/?$/);
        if (!m) continue;
        const handle = m[1];
        if (handle && !SKIP_HANDLES.has(handle.toLowerCase())) { emitViewer(handle); return; }
      }
    } catch {}
  }

  // Run on DOM ready and re-run whenever instagram.js requests a check
  if (document.readyState === "complete") detectViewerFromDom();
  else document.addEventListener("DOMContentLoaded", detectViewerFromDom);

  document.addEventListener("ig_viewer_check", detectViewerFromDom);
})();
