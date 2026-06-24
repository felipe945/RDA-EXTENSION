// page-interceptor.js — Injected into the PAGE world (not content script world)
// Wraps window.fetch to detect Instagram like and follow API calls.
// Fires CustomEvents that instagram.js listens for.
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
        window.dispatchEvent(
          new CustomEvent("ig-action", {
            detail: { type: "IG_FOLLOW", userId, username: "" },
          })
        );
      }
      // Like
      else if (/\/media\/.*\/like/.test(url)) {
        window.dispatchEvent(
          new CustomEvent("ig-action", {
            detail: { type: "IG_LIKE", userId: "", username: "" },
          })
        );
      }
    }

    return origFetch.apply(this, arguments);
  };
})();
