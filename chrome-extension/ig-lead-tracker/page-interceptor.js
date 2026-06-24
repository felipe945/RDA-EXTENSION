// Injected into the PAGE world to intercept Instagram's fetch calls
// Must be in web_accessible_resources and injected via instagram.js

(function () {
  if (window.__igInterceptorInstalled) return;
  window.__igInterceptorInstalled = true;

  const origFetch = window.fetch;

  window.fetch = async function (input, init) {
    const url = typeof input === "string" ? input : input?.url ?? "";

    // Follow detection
    if (/\/friendships\//.test(url) && (/\/follow\//.test(url) || /\/create\//.test(url))) {
      const userId = url.match(/\/friendships\/(\d+)/)?.[1];
      window.dispatchEvent(
        new CustomEvent("ig_action", { detail: { type: "follow", userId } })
      );
    }

    // Like detection
    if (/\/media\//.test(url) && /\/like\//.test(url) && (!init?.method || init.method === "POST")) {
      const userId = url.match(/\/media\/(\d+)/)?.[1];
      window.dispatchEvent(
        new CustomEvent("ig_action", { detail: { type: "like", userId, postUrl: window.location.href } })
      );
    }

    return origFetch.apply(this, arguments);
  };
})();
