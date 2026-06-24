// Content script on instagram.com
// Injects the fetch interceptor into the page world and bridges events to background

(function () {
  // Inject page-interceptor.js into page world
  const script = document.createElement("script");
  script.src = chrome.runtime.getURL("page-interceptor.js");
  script.onload = () => script.remove();
  (document.head || document.documentElement).appendChild(script);

  // Username cache: userId -> username
  const userCache = {};

  function extractUsernameFromUrl() {
    const m = window.location.pathname.match(/^\/([^\/]+)\/?$/);
    return m ? m[1] : null;
  }

  function extractUserIdFromUrl() {
    // e.g. /friendships/123456/
    const m = window.location.pathname.match(/\/(\d+)/);
    return m ? m[1] : null;
  }

  function observeProfileHeader() {
    // Try to grab the username from the profile page h2 or URL
    const h2 = document.querySelector("h2");
    if (h2 && h2.innerText) {
      const uid = extractUserIdFromUrl() || Date.now().toString();
      userCache[uid] = h2.innerText.trim();
    }
    const fromUrl = extractUsernameFromUrl();
    if (fromUrl && fromUrl !== "explore" && fromUrl !== "reels" && fromUrl !== "stories") {
      const uid = extractUserIdFromUrl() || fromUrl;
      userCache[uid] = fromUrl;
    }
  }

  // Listen for events dispatched by page-interceptor.js
  window.addEventListener("ig_action", (e) => {
    const { type, userId, postUrl } = e.detail;
    const username = userCache[userId] || extractUsernameFromUrl() || userId || "unknown";

    chrome.runtime.sendMessage({
      type: type === "follow" ? "IG_FOLLOW" : "IG_LIKE",
      username,
      userId,
      pageUrl: postUrl || window.location.href,
    });
  });

  // SPA navigation watcher
  let lastUrl = location.href;
  setInterval(() => {
    if (location.href !== lastUrl) {
      lastUrl = location.href;
      observeProfileHeader();
    }
  }, 800);

  observeProfileHeader();
})();
