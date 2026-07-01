// LinkedIn content script — detect profile visits + unread reply notifications
(function () {
  let lastUrl = location.href;
  const processedIds = new Set();

  // ── Extract display name from a LinkedIn profile page ───────────────────────
  function getProfileName() {
    const candidates = [
      document.querySelector("h1"),
      document.querySelector(".pv-top-card--list > li:first-child"),
      document.querySelector(".artdeco-entity-lockup__title"),
    ];
    for (const el of candidates) {
      const t = el?.textContent?.trim();
      if (t && t.length > 1 && t.length < 80) return t;
    }
    // Fallback: parse from URL /in/first-last
    const m = location.pathname.match(/\/in\/([^/?]+)/);
    return m ? m[1].replace(/-/g, " ") : null;
  }

  // ── Scan messaging page for unread conversations ─────────────────────────────
  function scanMessages() {
    // LinkedIn renders conversations in a list; selector varies by version
    const items = document.querySelectorAll([
      ".msg-conversation-listitem",
      ".msg-conversations-container__convo-item",
      "[data-control-name='overlay.dm_conversation']",
      ".msg-conversation-card",
    ].join(", "));

    for (const item of items) {
      // Unique key per item
      const key =
        item.dataset.occludableKey ||
        item.getAttribute("data-coui-entity-urn") ||
        item.querySelector("[href]")?.getAttribute("href") ||
        item.innerText.slice(0, 40);

      if (processedIds.has(key)) continue;

      // Check for unread indicator
      const hasUnread =
        item.querySelector(".notification-badge") ||
        item.querySelector(".msg-conversation-listitem__unread-count") ||
        item.querySelector("[class*='unread-count']") ||
        item.querySelector("[class*='notification-badge']") ||
        item.classList.contains("msg-conversation-listitem--unread");

      if (!hasUnread) continue;

      // Extract sender name
      const nameEl =
        item.querySelector(".msg-conversation-card__participant-names") ||
        item.querySelector(".msg-conversation-listitem__participant-names") ||
        item.querySelector("[class*='participant-names']") ||
        item.querySelector("strong");

      const snippetEl =
        item.querySelector(".msg-conversation-card__message-snippet-body") ||
        item.querySelector("[class*='message-snippet']") ||
        item.querySelector("[class*='last-activity']");

      const detectedName = nameEl?.textContent?.trim();
      if (!detectedName) continue;

      processedIds.add(key);

      chrome.runtime.sendMessage({
        type: "CROSS_PLATFORM_REPLY",
        platform: "linkedin",
        detectedName,
        messagePreview: snippetEl?.textContent?.trim() || null,
        url: location.href,
      }, (res) => {
        if (res?.matched) {
          console.log(`[FanBasis] LinkedIn reply matched lead: ${res.leadName}`);
        }
      });
    }
  }

  // ── Watch for navigation (LinkedIn is a SPA) ──────────────────────────────────
  function onNavigate() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    processedIds.clear();
    if (location.pathname.startsWith("/messaging")) {
      setTimeout(scanMessages, 2000);
    }
  }

  // ── Initialize ────────────────────────────────────────────────────────────────
  if (location.pathname.startsWith("/messaging")) {
    setTimeout(scanMessages, 2500);
  }

  // Poll for SPA navigation
  setInterval(onNavigate, 1000);

  // DOM mutation watcher for dynamic loads
  new MutationObserver(() => {
    if (location.pathname.startsWith("/messaging")) scanMessages();
  }).observe(document.body, { childList: true, subtree: true });
})();
