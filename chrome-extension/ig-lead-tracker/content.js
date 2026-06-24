// ManyChat content script — tracks prospects interacting via ManyChat

(function () {
  let lastTracked = null;

  function scanContacts() {
    const contacts = document.querySelectorAll(".contact-list-item, .subscriber-item, [data-subscriber-id]");
    contacts.forEach((el) => {
      const nameEl = el.querySelector(".name, .contact-name, .subscriber-name");
      if (!nameEl) return;
      const name = nameEl.innerText.trim();
      if (!name || name === lastTracked) return;

      el.addEventListener("click", () => {
        if (lastTracked === name) return;
        lastTracked = name;
        chrome.runtime.sendMessage({
          type: "IG_LIKE",
          username: name,
          userId: el.dataset.subscriberId ?? null,
          pageUrl: window.location.href,
        });
      }, { once: true });
    });
  }

  const observer = new MutationObserver(scanContacts);
  observer.observe(document.body, { childList: true, subtree: true });
  scanContacts();
})();
