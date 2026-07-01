// AgoraPulse content script — auto-tracks DMs managed through AgoraPulse
// Watches for conversation opens and extracts IG username

(function () {
  function extractUsername(el) {
    const link = el?.querySelector("a[href*='instagram.com']");
    if (link) {
      const m = link.href.match(/instagram\.com\/([^\/\?]+)/);
      return m ? m[1] : null;
    }
    const name = el?.querySelector(".conversation-contact-name, .contact-name");
    return name?.innerText?.trim() ?? null;
  }

  let lastTracked = null;
  const observer = new MutationObserver(() => {
    const active = document.querySelector(".conversation-item.active, .conversation.active");
    if (!active) return;
    const username = extractUsername(active);
    if (!username || username === lastTracked) return;
    lastTracked = username;
    chrome.runtime.sendMessage({ type: "IG_LIKE", username, userId: null, pageUrl: window.location.href });
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
