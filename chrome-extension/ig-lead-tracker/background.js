chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

async function getConfig() {
  return new Promise((resolve) => {
    chrome.storage.sync.get({ dashboardUrl: 'http://localhost:3000', igEventsSecret: '' }, resolve);
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'SAVE_LEAD') {
    (async () => {
      try {
        const { dashboardUrl, igEventsSecret } = await getConfig();
        const res = await fetch(`${dashboardUrl}/api/ig-events`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-ig-events-secret': igEventsSecret,
          },
          body: JSON.stringify(msg.payload),
        });
        const data = await res.json();
        sendResponse({ ok: res.ok, data });
      } catch (err) {
        // Queue for retry
        const { retryQueue = [] } = await chrome.storage.local.get('retryQueue');
        retryQueue.push({ payload: msg.payload, ts: Date.now() });
        await chrome.storage.local.set({ retryQueue });
        sendResponse({ ok: false, queued: true });
      }
    })();
    return true; // async
  }

  if (msg.type === 'FETCH_LEADS') {
    (async () => {
      try {
        const { dashboardUrl } = await getConfig();
        const res = await fetch(`${dashboardUrl}/api/leads?mode=sales`);
        const data = await res.json();
        sendResponse({ ok: true, data });
      } catch (err) {
        sendResponse({ ok: false, error: String(err) });
      }
    })();
    return true;
  }

  if (msg.type === 'CHECK_LEAD') {
    (async () => {
      try {
        const { dashboardUrl } = await getConfig();
        const url = `${dashboardUrl}/api/leads?ig_username=${encodeURIComponent(msg.igUsername)}`;
        const res = await fetch(url);
        const data = await res.json();
        const lead = data?.leads?.[0] ?? null;
        sendResponse({ ok: true, lead });
      } catch (err) {
        sendResponse({ ok: false, lead: null });
      }
    })();
    return true;
  }
});
