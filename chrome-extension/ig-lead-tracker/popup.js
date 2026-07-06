document.getElementById("openPanel").addEventListener("click", () => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id != null) chrome.sidePanel.open({ tabId: tabs[0].id });
  });
  window.close();
});

document.getElementById("openDashboard").addEventListener("click", () => {
  chrome.storage.sync.get({ dashboardUrl: "https://fanmas.vercel.app" }, ({ dashboardUrl }) => {
    chrome.tabs.create({ url: dashboardUrl });
    window.close();
  });
});

function showStats(leads, overdue, notifs) {
  const active = (leads ?? []).filter((l) => !["Closed", "DQ", "Churned"].includes(l.stage)).length;
  const el = document.getElementById("stats");
  el.innerHTML =
    `${active} lead${active !== 1 ? "s" : ""}` +
    (overdue > 0 ? ` · <span class="stat-urgent">${overdue} overdue</span>` : "") +
    (notifs > 0 ? ` · <span class="stat-urgent">${notifs} replies</span>` : "");
}

chrome.storage.local.get({ fb_cache: null }, ({ fb_cache }) => {
  showStats(
    fb_cache?.leads ?? [],
    fb_cache?.overdue?.length ?? 0,
    fb_cache?.notifications?.length ?? 0
  );
  chrome.runtime.sendMessage({ type: "REFRESH_CACHE" }, () => void chrome.runtime.lastError);
});
