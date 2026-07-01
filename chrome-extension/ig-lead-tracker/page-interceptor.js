// Injected into the PAGE world to intercept Instagram's fetch calls
// Must be in web_accessible_resources and injected via instagram.js

(function () {
  if (window.__igInterceptorInstalled) return;
  window.__igInterceptorInstalled = true;

  const origFetch = window.fetch;

  window.fetch = function (input, init) {
    const url = typeof input === "string" ? input : (input && input.url) ? input.url : "";
    const method = ((init && init.method) || "GET").toUpperCase();

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
      // DM send detection
      else if (
        url.includes("/direct_v2/threads/") ||
        url.includes("/api/v1/direct/")
      ) {
        document.dispatchEvent(new CustomEvent("ig_dm_sent", { bubbles: true, composed: true }));
      }
    }

    // After any fetch — try to read viewer from GraphQL/API response first, then fall back to DOM
    const p = origFetch.apply(this, arguments);
    p.then(async (res) => {
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
    return origOpen.apply(this, [method, url, ...rest]);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
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
      if (
        this._url &&
        (this._url.includes("/direct_v2/threads/") || this._url.includes("/api/v1/direct/"))
      ) {
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
