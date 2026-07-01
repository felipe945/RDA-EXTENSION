// Twitter/X content script — detect unread DMs from tracked leads
(function () {
  let lastUrl = location.href;
  const processedIds = new Set();

  // ── Scan DM conversation list for unread items ────────────────────────────────
  function scanDMs() {
    const items = document.querySelectorAll([
      "[data-testid='conversation']",
      "[data-testid='DmConversationEntry']",
      "[data-testid='DMConversationEntry']",
    ].join(", "));

    for (const item of items) {
      const key =
        item.getAttribute("href") ||
        item.getAttribute("aria-labelledby") ||
        item.innerText.slice(0, 40);

      if (processedIds.has(key)) continue;

      // Check for unread badge
      const hasUnread =
        item.querySelector("[data-testid='unreadBadge']") ||
        item.querySelector("[data-testid='unread-badge']") ||
        item.querySelector("[class*='unread']") ||
        item.querySelector("[aria-label*='unread']");

      if (!hasUnread) continue;

      // Extract sender name — try multiple selectors Twitter uses
      const nameEl =
        item.querySelector("[data-testid='conversationHeader'] span:not([class*='follow'])") ||
        item.querySelector("[dir='ltr'] > span") ||
        item.querySelector("strong") ||
        item.querySelector("span[class*='title']");

      const snippetEl =
        item.querySelector("[data-testid='messageEntry']") ||
        item.querySelector("[data-testid='lastMessage']") ||
        item.querySelector("[class*='snippet']");

      const detectedName = nameEl?.textContent?.trim();
      if (!detectedName || detectedName === "You") continue;

      processedIds.add(key);

      chrome.runtime.sendMessage({
        type: "CROSS_PLATFORM_REPLY",
        platform: "twitter",
        detectedName,
        messagePreview: snippetEl?.textContent?.trim() || null,
        url: location.href,
      }, (res) => {
        if (res?.matched) {
          console.log(`[FanBasis] Twitter reply matched lead: ${res.leadName}`);
        }
      });
    }
  }

  // ── Watch for navigation (Twitter is a SPA) ────────────────────────────────────
  function onNavigate() {
    if (location.href === lastUrl) return;
    lastUrl = location.href;
    processedIds.clear();
    if (location.pathname.startsWith("/messages")) {
      setTimeout(scanDMs, 1500);
    }
  }

  // ── Initialize ────────────────────────────────────────────────────────────────
  if (location.pathname.startsWith("/messages")) {
    setTimeout(scanDMs, 2000);
  }

  setInterval(onNavigate, 1000);

  new MutationObserver(() => {
    if (location.pathname.startsWith("/messages")) scanDMs();
  }).observe(document.body, { childList: true, subtree: true });
})();
