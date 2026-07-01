// FanBasis sidepanel — unified lead pipeline + notifications
"use strict";

const DEFAULT_URL = "https://unified-sales-ops.vercel.app";

let allLeads = [];
let notifications = [];
let overdueLeads = [];
let activeFilter = "all";
let activeTab = "notifs";
let dashboardUrl = DEFAULT_URL;

// ── Helpers ───────────────────────────────────────────────────────────────────

function relTime(ts) {
  if (!ts) return "";
  const diff = Date.now() - new Date(ts).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 60) return m <= 1 ? "just now" : `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function dueLabel(iso) {
  if (!iso) return "";
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) {
    const h = Math.floor(-diff / 3600000);
    return h < 24 ? `${h}h overdue` : `${Math.floor(h / 24)}d overdue`;
  }
  const h = Math.floor(diff / 3600000);
  return h < 24 ? `due in ${h}h` : `due in ${Math.floor(h / 24)}d`;
}

function urgency(lead) {
  if (!lead) return "upcoming";
  if (["Closed", "DQ", "Churned"].includes(lead.stage)) return "archived";
  if (["Booked", "Active"].includes(lead.stage)) return "booked";
  if (!lead.due_at) return "upcoming";
  const due = new Date(lead.due_at);
  const now = new Date();
  const eod = new Date(now); eod.setHours(23, 59, 59, 999);
  if (due < now) return "overdue";
  if (due <= eod) return "today";
  return "upcoming";
}

function needsFU(lead) {
  const u = urgency(lead);
  return u === "overdue" || u === "today";
}

function scoreColor(s) {
  if (s >= 75) return "#22c55e";
  if (s >= 50) return "#f59e0b";
  return "#ef4444";
}

function stageColor(stage) {
  const c = {
    "New": "#64748b", "Warming": "#f59e0b", "DM Sent": "#3b82f6",
    "Replied": "#8b5cf6", "Qualifying": "#06b6d4",
    "Call Offered": "#10b981", "Booked": "#22c55e",
    "Closed": "#475569", "DQ": "#ef4444",
  };
  return c[stage] || "#64748b";
}

function channelIcon(ch) {
  const m = { ig: "📸", instagram: "📸", email: "✉️", gmail: "✉️", linkedin: "💼", twitter: "🐦", sms: "💬" };
  return m[(ch || "").toLowerCase()] || "💬";
}

function igUrl(lead) {
  return lead.ig_profile_url || (lead.ig_username ? `https://www.instagram.com/${lead.ig_username}/` : null);
}

function displayName(lead) {
  return lead.ig_username ? `@${lead.ig_username}` : (lead.name || "Unnamed");
}

function esc(str) {
  return (str || "").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;");
}

// Navigate the existing Instagram tab instead of opening a new one
function openInIgTab(url) {
  if (!url) return;
  if (url.includes("instagram.com")) {
    chrome.tabs.query({ url: "*://www.instagram.com/*" }, (tabs) => {
      if (tabs.length > 0) {
        chrome.tabs.update(tabs[0].id, { url, active: true });
      } else {
        chrome.tabs.create({ url });
      }
    });
  } else {
    chrome.tabs.create({ url });
  }
}

// ── Tab switching ─────────────────────────────────────────────────────────────

document.querySelectorAll(".tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-content").forEach((c) => c.classList.remove("active-tab"));
    btn.classList.add("active");
    activeTab = btn.dataset.tab;
    document.getElementById(`tab-${activeTab}`).classList.add("active-tab");
    renderActiveTab();
  });
});

function renderActiveTab() {
  if (activeTab === "notifs") renderNotifications();
  else if (activeTab === "leads") renderLeads();
  else if (activeTab === "outreach") renderOutreach();
  else if (activeTab === "scripts") renderScripts();
}

// ── Notifications tab ─────────────────────────────────────────────────────────

function renderNotifications() {
  const list = document.getElementById("notifList");
  const items = [];

  // Overdue follow-ups
  for (const lead of overdueLeads.slice(0, 8)) {
    const url = igUrl(lead);
    items.push(`
      <div class="notif-row notif-fu">
        <div class="notif-icon-wrap fu-icon">🔥</div>
        <div class="notif-body">
          <div class="notif-name">${esc(displayName(lead))}</div>
          <div class="notif-sub">${esc(dueLabel(lead.due_at))} · Follow-up overdue</div>
        </div>
        <div class="notif-actions">
          ${url ? `<button class="notif-btn open-btn" data-url="${esc(url)}">Open</button>` : ""}
        </div>
      </div>
    `);
  }

  // Reply notifications
  for (const n of notifications) {
    items.push(`
      <div class="notif-row notif-reply">
        <div class="notif-icon-wrap">${channelIcon(n.channel)}</div>
        <div class="notif-body">
          <div class="notif-name">${esc(n.leadName)}${n.leadHandle && n.leadHandle !== n.leadName ? ` <span class="notif-handle">@${esc(n.leadHandle)}</span>` : ""}</div>
          ${n.summary ? `<div class="notif-msg">${esc(n.summary)}</div>` : ""}
          <div class="notif-sub">${channelIcon(n.channel)} ${esc(n.channel)} · ${relTime(n.ts)}</div>
        </div>
        <div class="notif-actions">
          <button class="notif-btn stage-replied-btn" data-id="${esc(n.leadId)}">Replied</button>
        </div>
      </div>
    `);
  }

  if (!items.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🎯</div>
        <p>All clear!</p>
        <span>Replies from Gmail, LinkedIn, and Twitter appear here automatically.</span>
      </div>`;
    return;
  }

  list.innerHTML = items.join("");

  list.querySelectorAll(".open-btn").forEach((btn) => {
    btn.addEventListener("click", () => openInIgTab(btn.dataset.url));
  });

  list.querySelectorAll(".stage-replied-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.textContent = "✓";
      btn.disabled = true;
      await chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: btn.dataset.id, updates: { stage: "Replied" } });
      await loadData();
    });
  });
}

// ── Pipeline / Leads tab ──────────────────────────────────────────────────────

function renderLeads() {
  // Stats chips
  const statsRow = document.getElementById("statsRow");
  const fuCount = allLeads.filter(needsFU).length;
  const repliedCount = allLeads.filter((l) => l.stage === "Replied").length;
  const bookedCount = allLeads.filter((l) => ["Booked", "Active"].includes(l.stage)).length;

  statsRow.innerHTML = [
    fuCount > 0 ? `<button class="stat-chip chip-red ${activeFilter === "needs_fu" ? "chip-active" : ""}" data-filter="needs_fu">${fuCount} Needs FU</button>` : "",
    repliedCount > 0 ? `<button class="stat-chip chip-purple ${activeFilter === "replied" ? "chip-active" : ""}" data-filter="replied">${repliedCount} Replied</button>` : "",
    bookedCount > 0 ? `<button class="stat-chip chip-green ${activeFilter === "booked" ? "chip-active" : ""}" data-filter="booked">${bookedCount} Booked</button>` : "",
  ].filter(Boolean).join("");

  statsRow.querySelectorAll(".stat-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      activeFilter = activeFilter === chip.dataset.filter ? "all" : chip.dataset.filter;
      document.querySelectorAll(".filter").forEach((f) => f.classList.toggle("active", f.dataset.filter === activeFilter));
      renderLeads();
    });
  });

  // Filter leads
  const visible = allLeads.filter((l) => {
    switch (activeFilter) {
      case "all":       return !["Closed", "DQ", "Churned"].includes(l.stage);
      case "needs_fu":  return needsFU(l);
      case "replied":   return l.stage === "Replied";
      case "booked":    return ["Booked", "Active"].includes(l.stage);
      case "new":       return ["New", "Warming"].includes(l.stage);
      default:          return true;
    }
  });

  const list = document.getElementById("leadList");

  if (!visible.length) {
    list.innerHTML = `<div class="empty-state"><p>No leads in this view.</p></div>`;
    return;
  }

  list.innerHTML = visible.map((lead) => {
    const cache = lead.research_cache || {};
    const score = typeof cache.fitScore === "number" ? cache.fitScore : null;
    const opener = typeof cache.suggestedOpener === "string" ? cache.suggestedOpener : null;
    const stack = Array.isArray(cache.stackDetected) ? cache.stackDetected : [];
    const url = igUrl(lead);
    const u = urgency(lead);
    const isUrgent = u === "overdue" || u === "today";

    return `
      <div class="lead-item ${isUrgent ? "lead-urgent" : ""}">
        <div class="lead-header">
          <div class="lead-name">
            ${esc(displayName(lead))}
            ${score !== null ? `<span class="score-badge" style="color:${scoreColor(score)}">${score}</span>` : ""}
            ${lead.research_status === "pending" ? '<span class="pulse-dot"></span>' : ""}
          </div>
          <span class="stage-tag" style="background:${stageColor(lead.stage)}22;color:${stageColor(lead.stage)};border-color:${stageColor(lead.stage)}44">${esc(lead.stage)}</span>
        </div>

        ${lead.due_at ? `<div class="lead-due ${isUrgent ? "due-urgent" : ""}">${esc(dueLabel(lead.due_at))}</div>` : ""}

        ${stack.length ? `<div class="stack-pills">${stack.slice(0, 3).map((s) => `<span class="stack-pill">${esc(s)}</span>`).join("")}</div>` : ""}

        ${opener ? `
          <div class="opener-preview">
            <span class="opener-label">Opener</span>
            <p>${esc(opener.slice(0, 90))}${opener.length > 90 ? "…" : ""}</p>
          </div>
        ` : ""}

        <div class="lead-footer">
          ${url ? `<button class="btn-sm btn-pink open-ig-btn" data-url="${esc(url)}" data-opener="${encodeURIComponent(opener || "")}">📸 Open${opener ? " + Copy" : ""}</button>` : ""}
          <button class="btn-sm view-profile-btn" style="background:none;border:1px solid #1e1e2a;color:#475569;font-size:10px" data-lead-id="${esc(lead.id)}">View →</button>
          <div class="quick-stages">
            ${["DM Sent", "Replied", "Qualifying", "Call Offered", "Booked"].map((s) => `
              <button class="qs-btn ${lead.stage === s ? "qs-active" : ""}" data-id="${esc(lead.id)}" data-stage="${s}" style="${lead.stage === s ? `color:${stageColor(s)};border-color:${stageColor(s)}` : ""}">${s}</button>
            `).join("")}
          </div>
        </div>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".open-ig-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const opener = decodeURIComponent(btn.dataset.opener || "");
      if (opener) navigator.clipboard.writeText(opener).catch(() => {});
      openInIgTab(btn.dataset.url);
    });
  });

  list.querySelectorAll(".view-profile-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      chrome.tabs.create({ url: `${dashboardUrl}/leads/${btn.dataset.leadId}` });
    });
  });

  list.querySelectorAll(".qs-btn").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      btn.disabled = true;
      await chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: btn.dataset.id, updates: { stage: btn.dataset.stage } });
      await loadData();
    });
  });

  // Clicking a lead row opens that profile in the active IG tab and switches to Outreach
  list.querySelectorAll(".lead-item").forEach((item) => {
    item.addEventListener("click", (e) => {
      // Don't fire if user clicked a button inside the row
      if (e.target.closest("button, a")) return;
      const leadId = item.querySelector(".view-profile-btn")?.dataset.leadId;
      if (!leadId) return;
      const target = allLeads.find(l => l.id === leadId);
      if (!target) return;
      const url = target.ig_profile_url || (target.ig_username ? `https://www.instagram.com/${target.ig_username}/` : null);
      if (url) openInIgTab(url);
      // Switch to outreach tab
      const outreachTab = document.querySelector('.tab[data-tab="outreach"]');
      if (outreachTab) outreachTab.click();
    });
  });
}

// ── Outreach tab — focused flashcard queue ────────────────────────────────────

let outreachChannel = "ig"; // "ig" | "linkedin"
let outreachIdx = 0;
let snoozedLeads = {};    // { leadId: snoozeUntilMs }
let fbChannelDone = {};   // { leadId: { fb: boolean, pers: boolean } }
let researchPollTimer = null;
let fanbasisHandle = "";
let personalIgUsername = "";
let calendarUrl = "";
let quickSaveTabId = null;

async function loadSnoozedLeads() {
  const { fb_snoozed = {} } = await chrome.storage.local.get({ fb_snoozed: {} });
  const now = Date.now();
  snoozedLeads = Object.fromEntries(Object.entries(fb_snoozed).filter(([, ts]) => ts > now));
  await chrome.storage.local.set({ fb_snoozed: snoozedLeads });
}

async function snoozeLeadLocal(leadId, days) {
  snoozedLeads[leadId] = Date.now() + days * 24 * 3600 * 1000;
  await chrome.storage.local.set({ fb_snoozed: snoozedLeads });
}

function getChannelDone(leadId) {
  return fbChannelDone[leadId] || { fb: false, pers: false };
}

function setChannelDone(leadId, channel, val) {
  if (!fbChannelDone[leadId]) fbChannelDone[leadId] = { fb: false, pers: false };
  fbChannelDone[leadId][channel] = val;
}

function stopResearchPoll() {
  if (researchPollTimer) { clearInterval(researchPollTimer); researchPollTimer = null; }
}

function startResearchPoll(leadId) {
  stopResearchPoll();
  researchPollTimer = setInterval(async () => {
    await chrome.runtime.sendMessage({ type: "REFRESH_CACHE" });
    const resp = await new Promise((r) => chrome.runtime.sendMessage({ type: "GET_LEADS" }, r));
    const lead = (resp?.leads ?? []).find((l) => l.id === leadId);
    if (!lead || lead.research_status !== "pending") {
      if (resp?.leads) allLeads = resp.leads;
      stopResearchPoll();
      renderOutreach();
    }
  }, 5000);
}

async function updateAccountPill() {
  const { activeIgAccount = "" } = await chrome.storage.local.get({ activeIgAccount: "" });
  const pill = document.getElementById("account-pill");
  const label = document.getElementById("account-label");
  if (!pill || !label) return;
  if (!activeIgAccount) { pill.style.display = "none"; return; }
  pill.style.display = "flex";
  label.textContent = `@${activeIgAccount}`;
  const cleanFb = fanbasisHandle.replace(/^@/, "").toLowerCase();
  const cleanPers = personalIgUsername.replace(/^@/, "").toLowerCase();
  const activeAcct = activeIgAccount.toLowerCase();
  if ((cleanFb && activeAcct === cleanFb) || (cleanPers && activeAcct === cleanPers)) {
    pill.className = "account-pill correct";
  } else if (cleanFb || cleanPers) {
    pill.className = "account-pill wrong";
  } else {
    pill.className = "account-pill";
  }
}

function updateQuickSaveBar(tab) {
  const bar = document.getElementById("quick-save-bar");
  const cur = document.getElementById("current-user");
  if (!bar || !cur) return;
  if (tab && tab.url && tab.url.includes("instagram.com/")) {
    const match = tab.url.match(/instagram\.com\/([a-zA-Z0-9._]+)/);
    const u = match ? match[1] : "";
    const skip = ["p", "reel", "reels", "explore", "direct", "stories", "accounts"];
    if (u && !skip.includes(u)) {
      bar.style.display = "flex";
      cur.textContent = `@${u}`;
      quickSaveTabId = tab.id;
      return;
    }
  }
  bar.style.display = "none";
  quickSaveTabId = null;
}

chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  if (tabs[0]) updateQuickSaveBar(tabs[0]);
});

chrome.tabs.onActivated.addListener(({ tabId }) => {
  chrome.tabs.get(tabId, (tab) => { if (tab) updateQuickSaveBar(tab); });
});

let _onUpdatedTimer = null;
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (!changeInfo.url) return;
  if (!changeInfo.url.includes("instagram.com")) return; // skip non-IG tabs immediately
  clearTimeout(_onUpdatedTimer);
  _onUpdatedTimer = setTimeout(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0] || tabs[0].id !== tabId) return;
      updateQuickSaveBar(tab);

      // When navigating to an IG profile, sync the outreach card to that lead
      const match = changeInfo.url.match(/instagram\.com\/([a-zA-Z0-9._]+)\/?/);
      const skip = new Set(["p","reel","reels","explore","direct","stories","accounts","tv","ar","login"]);
      const username = match && !skip.has(match[1]) ? match[1].toLowerCase() : null;
      if (!username) return;

      // Refresh data first (allLeads may be stale), then sync card
      loadData().then(() => {
        const queue = buildOutreachQueue(outreachChannel);
        const idx = queue.findIndex(l => (l.ig_username || "").toLowerCase() === username);
        if (idx !== -1) {
          outreachIdx = idx;
          if (activeTab === "outreach") renderOutreach();
        }
      });
    });
  }, 150); // debounce rapid SPA navigations
});

document.getElementById("quick-save-btn").addEventListener("click", async () => {
  if (!quickSaveTabId) return;
  await chrome.tabs.sendMessage(quickSaveTabId, { type: "TRIGGER_SAVE" }).catch(() => {});
});

function sfBadgeHtml(lead) {
  const s = lead.sf_status;
  if (!s || s === "none") return "";
  const cfg = { customer: ["🟢", "#4ade80"], inactive: ["🟡", "#fbbf24"], prospect: ["🔵", "#60a5fa"] }[s];
  if (!cfg) return "";
  const score = lead.sf_confidence_score > 0 ? ` ${lead.sf_confidence_score}%` : "";
  return `<span class="sf-badge" style="color:${cfg[1]};border-color:${cfg[1]}44">${cfg[0]} SF${score}</span>`;
}

function fmtFollowers(n) {
  if (!n) return "";
  if (n >= 1000000) return `${(n / 1000000).toFixed(1)}M`;
  if (n >= 1000) return `${Math.round(n / 1000)}K`;
  return String(n);
}

function getOpener(lead, channel) {
  const cache = lead.research_cache || {};
  if (channel === "linkedin") {
    const byChannel = cache.outreachByChannel || {};
    return byChannel.linkedin || cache.suggestedOpener || "";
  }
  return cache.suggestedOpener || "";
}

function buildOutreachQueue(channel) {
  const DONE = ["DM Sent", "Replied", "Qualifying", "Call Offered", "Booked", "Closed", "DQ", "Active", "Churned", "Blocked"];
  const now = Date.now();
  return allLeads
    .filter((l) => !DONE.includes(l.stage))
    .filter((l) => !snoozedLeads[l.id] || snoozedLeads[l.id] <= now)
    .filter((l) => {
      if (channel === "ig") return !!(l.ig_username || l.ig_profile_url);
      if (channel === "linkedin") return !!l.linkedin_url;
      return true;
    })
    .sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
}

function showSidepanelSlotPicker(container, lead, slots, slotMins) {
  slotMins = slotMins || 45;
  const existing = document.getElementById("sp-slot-picker");
  if (existing) existing.remove();

  const picker = document.createElement("div");
  picker.id = "sp-slot-picker";
  picker.style.cssText = "margin-top:10px;background:#13131a;border:1px solid #1e1e2a;border-radius:8px;overflow:hidden";

  const head = document.createElement("div");
  head.style.cssText = "padding:8px 12px;background:#0e1e38;border-bottom:1px solid #1e1e2a;font-size:10px;font-weight:700;color:#93c5fd;letter-spacing:.04em;display:flex;align-items:center;gap:6px";
  const spLeadName = lead?.name || (lead?.ig_username ? `@${lead.ig_username}` : "Lead");
  head.innerHTML = `<span style="width:6px;height:6px;border-radius:50%;background:#4285F4;display:inline-block"></span> ${slotMins}-min slots for <strong style="color:#e2e8f0">${spLeadName}</strong>`;
  picker.appendChild(head);

  const selected = new Set(slots.slice(0, 3).map(s => s.start));

  function fmtSlot(isoStart) {
    const d = new Date(isoStart);
    const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
    const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
    const h = d.getHours(); const m = d.getMinutes();
    const h12 = h % 12 || 12; const ampm = h >= 12 ? "pm" : "am";
    const minStr = m === 0 ? "" : `:${String(m).padStart(2,"0")}`;
    return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()} · ${h12}${minStr}${ampm}`;
  }

  const listEl = document.createElement("div");
  listEl.style.cssText = "padding:6px 8px;display:flex;flex-direction:column;gap:3px";
  slots.forEach(slot => {
    const row = document.createElement("div");
    const isSel = selected.has(slot.start);
    row.style.cssText = `display:flex;align-items:center;gap:8px;padding:5px 7px;border-radius:5px;cursor:pointer;background:${isSel ? "#0e1e38" : "transparent"};border:1px solid ${isSel ? "#1d4ed8" : "transparent"}`;
    row.innerHTML = `
      <input type="checkbox" ${isSel ? "checked" : ""} style="accent-color:#4285F4;cursor:pointer;flex-shrink:0">
      <span style="font-size:11px;color:${isSel ? "#ddd" : "#666"};font-variant-numeric:tabular-nums">${fmtSlot(slot.start)}</span>
    `;
    const cb = row.querySelector("input");
    function updateRow() {
      if (cb.checked) { selected.add(slot.start); row.style.background = "#0e1e38"; row.style.borderColor = "#1d4ed8"; row.querySelector("span").style.color = "#ddd"; }
      else { selected.delete(slot.start); row.style.background = "transparent"; row.style.borderColor = "transparent"; row.querySelector("span").style.color = "#666"; }
    }
    cb.addEventListener("change", () => { if (!cb.checked || selected.size <= 3) updateRow(); else cb.checked = false; });
    row.addEventListener("click", (e) => { if (e.target !== cb) { if (cb.checked) { cb.checked = false; } else if (selected.size < 3) { cb.checked = true; } updateRow(); } });
    listEl.appendChild(row);
  });
  picker.appendChild(listEl);

  const footer = document.createElement("div");
  footer.style.cssText = "padding:8px;display:flex;gap:6px;border-top:1px solid #1e1e2a";
  const cancelBtn = document.createElement("button");
  cancelBtn.textContent = "Cancel";
  cancelBtn.style.cssText = "flex:1;background:#161616;border:1px solid #252525;border-radius:6px;color:#666;font-size:11px;padding:6px;cursor:pointer";
  cancelBtn.addEventListener("click", () => picker.remove());

  const copyBtn = document.createElement("button");
  copyBtn.textContent = "Copy DM text";
  copyBtn.style.cssText = "flex:2;background:#0f2540;border:1px solid #1d4ed8;border-radius:6px;color:#93c5fd;font-size:11px;font-weight:600;padding:6px;cursor:pointer";
  copyBtn.addEventListener("click", async () => {
    const chosen = [...selected];
    if (!chosen.length) return;
    function fmtShort(iso) {
      const dt = new Date(iso);
      const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
      const h = dt.getHours(); const m = dt.getMinutes();
      const h12 = h % 12 || 12; const ampm = h >= 12 ? "pm" : "am";
      const minStr = m === 0 ? "" : `:${String(m).padStart(2,"0")}`;
      return `${days[dt.getDay()]} at ${h12}${minStr}${ampm}`;
    }
    const texts = chosen.map(fmtShort);
    const slotText = texts.length === 1 ? texts[0] : texts.length === 2 ? `${texts[0]} or ${texts[1]}` : texts.slice(0,-1).join(", ") + ", or " + texts.at(-1);
    const dmText = `Happy to walk through the dashboard — no pitch, just ${slotMins} min.\n\nI'm open ${slotText} — any of those work?`;
    await navigator.clipboard.writeText(dmText).catch(() => {});
    await chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { stage: "Call Offered" } }).catch(() => {});
    copyBtn.textContent = "✓ Copied!";
    setTimeout(() => { copyBtn.textContent = "Copy times"; copyBtn.disabled = false; }, 1500);
  });

  const bookEventBtn = document.createElement("button");
  bookEventBtn.textContent = "📅 Book";
  bookEventBtn.title = "Create Google Calendar event";
  bookEventBtn.style.cssText = "flex:1;background:#0d2b18;border:1px solid #166534;border-radius:6px;color:#4ade80;font-size:11px;font-weight:600;padding:6px;cursor:pointer";
  bookEventBtn.addEventListener("click", () => {
    const chosen = [...selected];
    if (!chosen.length) return;
    footer.style.display = "none";

    const iStyle = "background:#0a1f10;border:1px solid #166534;border-radius:6px;color:#d1fae5;font-size:11px;padding:6px 8px;outline:none;width:100%;box-sizing:border-box";
    const form = document.createElement("div");
    form.style.cssText = "display:flex;flex-direction:column;gap:7px;padding:10px 0 4px";

    const emailInput = document.createElement("input");
    emailInput.type = "email";
    emailInput.placeholder = "Paste their email…";
    emailInput.style.cssText = iStyle;

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Their name (auto-detected)";
    nameInput.style.cssText = iStyle;
    nameInput.value = lead?.name || lead?.ig_username || "";

    emailInput.addEventListener("input", () => {
      if (!nameInput.dataset.edited) {
        const local = emailInput.value.split("@")[0];
        nameInput.value = local.split(/[._-]/).filter(Boolean).map(p => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
      }
    });
    nameInput.addEventListener("input", () => { nameInput.dataset.edited = "1"; });

    const slotLabel = document.createElement("div");
    slotLabel.textContent = "Which time did they confirm?";
    slotLabel.style.cssText = "color:#86efac;font-size:10px;font-weight:600;text-transform:uppercase;letter-spacing:.5px;margin-top:2px";

    const slotSel = document.createElement("select");
    slotSel.style.cssText = iStyle + ";cursor:pointer";
    function fmtShortSel(iso) {
      const dt = new Date(iso);
      const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
      const h = dt.getHours(); const m = dt.getMinutes();
      const h12 = h % 12 || 12; const ampm = h >= 12 ? "pm" : "am";
      const minStr = m === 0 ? "" : `:${String(m).padStart(2,"0")}`;
      return `${days[dt.getDay()]} at ${h12}${minStr}${ampm}`;
    }
    chosen.forEach((isoStart, i) => {
      const opt = document.createElement("option");
      opt.value = i;
      opt.textContent = fmtShortSel(isoStart);
      slotSel.appendChild(opt);
    });

    const formBtns = document.createElement("div");
    formBtns.style.cssText = "display:flex;gap:6px;margin-top:2px";

    const cancelForm = document.createElement("button");
    cancelForm.textContent = "← Back";
    cancelForm.style.cssText = "flex:0 0 auto;background:transparent;border:1px solid #374151;border-radius:6px;color:#9ca3af;font-size:10px;padding:6px 10px;cursor:pointer";
    cancelForm.addEventListener("click", () => { form.remove(); footer.style.display = ""; });

    const createBtn = document.createElement("button");
    createBtn.textContent = "📅 Create Event";
    createBtn.style.cssText = "flex:1;background:#0d2b18;border:1px solid #166534;border-radius:6px;color:#4ade80;font-size:11px;font-weight:600;padding:6px;cursor:pointer";
    createBtn.addEventListener("click", async () => {
      const idx = parseInt(slotSel.value, 10);
      const slot = slots.find(s => s.start === chosen[idx]);
      if (!slot) return;
      const leadName = nameInput.value.trim() || lead?.name || lead?.ig_username || "Lead";
      const guestEmail = emailInput.value.trim() || undefined;
      createBtn.textContent = "Creating…";
      createBtn.disabled = true;
      const result = await chrome.runtime.sendMessage({ type: "CREATE_CALENDAR_EVENT", slotStart: slot.start, slotEnd: slot.end, leadName, guestEmail }).catch(() => null);
      if (result?.ok) {
        form.innerHTML = "";
        const ok = document.createElement("div");
        ok.textContent = "✓ Event created!";
        ok.style.cssText = "color:#4ade80;font-size:12px;font-weight:600;text-align:center;padding:10px 8px";
        form.appendChild(ok);
        setTimeout(async () => { picker.remove(); await loadData(); }, 1400);
      } else {
        createBtn.textContent = "✗ Failed — try again";
        createBtn.style.borderColor = "#7f1d1d";
        createBtn.style.color = "#ef4444";
        createBtn.disabled = false;
      }
    });

    formBtns.appendChild(cancelForm);
    formBtns.appendChild(createBtn);
    form.appendChild(emailInput);
    form.appendChild(nameInput);
    form.appendChild(slotLabel);
    form.appendChild(slotSel);
    form.appendChild(formBtns);
    picker.appendChild(form);
  });

  footer.appendChild(cancelBtn);
  footer.appendChild(copyBtn);
  footer.appendChild(bookEventBtn);
  picker.appendChild(footer);
  container.appendChild(picker);
}

function renderOutreach() {
  stopResearchPoll();
  const queue = buildOutreachQueue(outreachChannel);
  outreachIdx = Math.min(outreachIdx, Math.max(0, queue.length - 1));

  const meta = document.getElementById("outreachCount");
  const list = document.getElementById("outreachList");

  // Channel switcher + count
  const igCount = buildOutreachQueue("ig").length;
  const liCount = buildOutreachQueue("linkedin").length;
  meta.innerHTML = `
    <div class="outreach-channel-bar">
      <button class="ch-btn ${outreachChannel === "ig" ? "active" : ""}" data-ch="ig">
        📸 IG <span class="ch-count">${igCount}</span>
      </button>
      <button class="ch-btn ${outreachChannel === "linkedin" ? "active" : ""}" data-ch="linkedin">
        💼 LinkedIn <span class="ch-count">${liCount}</span>
      </button>
    </div>
  `;
  meta.querySelectorAll(".ch-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      outreachChannel = btn.dataset.ch;
      outreachIdx = 0;
      renderOutreach();
    });
  });

  if (!queue.length) {
    list.innerHTML = `<div class="empty-state"><div class="empty-icon">🎉</div><p>Queue cleared!</p><span>All leads done or snoozed.</span></div>`;
    return;
  }

  const lead = queue[outreachIdx];
  const cache = lead.research_cache || {};
  const fitScore = typeof cache.fitScore === "number" ? cache.fitScore : null;
  const opener = getOpener(lead, outreachChannel);
  const stack = Array.isArray(cache.stackDetected) ? cache.stackDetected : [];
  const summary = typeof cache.summary === "string" ? cache.summary : null;
  const url = outreachChannel === "linkedin" ? lead.linkedin_url : igUrl(lead);
  const followers = fmtFollowers(lead.follower_count);
  const isPending = lead.research_status === "pending";

  // Sync touch chips from backend outreach_channels (written by IG card's markChannelSent)
  const outreachChs = lead.outreach_channels || {};
  if (outreachChs.ig_fanbasis?.sent && !getChannelDone(lead.id).fb) setChannelDone(lead.id, "fb", true);
  if (outreachChs.ig_personal?.sent && !getChannelDone(lead.id).pers) setChannelDone(lead.id, "pers", true);

  // Two-touch chip state (IG only)
  const { fb: fbDone, pers: persDone } = getChannelDone(lead.id);
  const bothDone = fbDone && persDone;
  const showTouchHint = outreachChannel === "ig" && (fbDone || persDone) && !bothDone;

  // "Already uses FanBasis" banner
  const alreadyUsesBanner = lead.sf_status === "customer"
    ? `<div style="background:#0d2b0d;border:1px solid #166534;border-radius:7px;padding:7px 10px;margin-bottom:8px;font-size:11px;font-weight:600;color:#4ade80">🟢 Already uses FanBasis — use expansion play</div>`
    : lead.sf_status === "inactive"
    ? `<div style="background:#2d1a00;border:1px solid #92400e;border-radius:7px;padding:7px 10px;margin-bottom:8px;font-size:11px;font-weight:600;color:#fbbf24">🟡 Former FanBasis customer — win-back opportunity</div>`
    : "";

  // Channel sent log pills (from persisted outreach_channels)
  const chSentPills = [];
  if (outreachChs.ig_fanbasis?.sent) {
    const t = outreachChs.ig_fanbasis.sentAt ? ` · ${relTime(outreachChs.ig_fanbasis.sentAt)}` : "";
    chSentPills.push(`<span style="font-size:10px;padding:2px 8px;border-radius:5px;background:#0d2b0d;border:1px solid #166534;color:#4ade80;white-space:nowrap">📸 FB ✓${t}</span>`);
  }
  if (outreachChs.ig_personal?.sent) {
    const t = outreachChs.ig_personal.sentAt ? ` · ${relTime(outreachChs.ig_personal.sentAt)}` : "";
    chSentPills.push(`<span style="font-size:10px;padding:2px 8px;border-radius:5px;background:#0d2b0d;border:1px solid #166534;color:#4ade80;white-space:nowrap">📸 Pers. ✓${t}</span>`);
  }
  if (outreachChs.linkedin?.sent) {
    const t = outreachChs.linkedin.sentAt ? ` · ${relTime(outreachChs.linkedin.sentAt)}` : "";
    chSentPills.push(`<span style="font-size:10px;padding:2px 8px;border-radius:5px;background:#0d2b0d;border:1px solid #166534;color:#4ade80;white-space:nowrap">💼 LI ✓${t}</span>`);
  }
  const channelSentHtml = chSentPills.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:4px;margin-bottom:6px">${chSentPills.join("")}</div>`
    : "";

  // AI opener 3-state block
  let aiBlock = "";
  if (opener) {
    aiBlock = `
      <div class="ai-opener-block">
        <div class="ai-opener-header">
          <span class="ai-label">✨ AI Opener</span>
          <button class="copy-btn" id="copyOpenerBtn">Copy</button>
        </div>
        <p class="ai-opener-text">${esc(opener)}</p>
      </div>`;
  } else if (isPending) {
    aiBlock = `
      <div class="ai-pending-block">
        <span class="pulse-dot"></span>
        <span>Generating opener…</span>
      </div>`;
  } else {
    aiBlock = `
      <div class="ai-generate-block">
        <button class="btn-generate-ai" id="generateAiBtn">✨ Generate Opener</button>
        <p class="generate-hint">Researches profile and writes a personalized opener</p>
      </div>`;
  }

  // Touch chips (IG only)
  const touchChipsHtml = outreachChannel === "ig" ? `
    <div class="touch-chips">
      <button class="touch-chip ${fbDone ? "touch-done" : ""}" id="fbChip">${fbDone ? "✓" : "○"} FB</button>
      <button class="touch-chip ${persDone ? "touch-done" : ""}" id="persChip">${persDone ? "✓" : "○"} Pers.</button>
    </div>
    ${showTouchHint ? `<p class="touch-hint">Mark channels done above before clicking DM Sent</p>` : ""}
  ` : "";

  const sentDisabled = false;

  list.innerHTML = `
    <div class="queue-progress">
      <span class="queue-pos">${outreachIdx + 1} / ${queue.length}</span>
      <div class="queue-bar-bg">
        <div class="queue-bar-fill" style="width:${Math.round((outreachIdx / Math.max(queue.length - 1, 1)) * 100)}%"></div>
      </div>
    </div>

    <div class="outreach-card flashcard">
      ${alreadyUsesBanner}
      <div class="outreach-top">
        <div class="outreach-name-row">
          <span class="outreach-name">${esc(displayName(lead))}</span>
          ${followers ? `<span class="followers-badge">${esc(followers)}</span>` : ""}
        </div>
        <div class="outreach-badges">
          ${sfBadgeHtml(lead)}
          ${fitScore !== null ? `<span class="score-sm" style="color:${scoreColor(fitScore)}">${fitScore} fit</span>` : ""}
          <span class="stage-tag" style="background:${stageColor(lead.stage)}22;color:${stageColor(lead.stage)};border-color:${stageColor(lead.stage)}44">${esc(lead.stage)}</span>
        </div>
      </div>

      ${stack.length ? `<div class="stack-pills">${stack.slice(0, 3).map((s) => `<span class="stack-pill">${esc(s)}</span>`).join("")}</div>` : ""}
      ${summary ? `<p class="lead-summary">${esc(summary)}</p>` : ""}

      ${aiBlock}
      ${touchChipsHtml}
      ${channelSentHtml}

      <div class="outreach-btns">
        ${url ? `<button class="${opener ? "btn-open-primary" : "btn-open-send"}" id="openSendBtn" data-url="${esc(url)}">
          ${outreachChannel === "linkedin" ? "💼 Open LinkedIn" : "📸 Open IG"}${opener ? " + Copy" : ""}
        </button>` : ""}
        <button class="btn-sent" id="markSentBtn" data-id="${esc(lead.id)}" ${sentDisabled ? "disabled" : ""}>
          ✓ DM Sent
        </button>
      </div>
      <div style="display:flex;gap:5px;margin-top:5px">
        <button style="flex:1;background:#161616;border:1px solid #7f1d1d;border-radius:6px;color:#ef4444;font-size:11px;font-weight:600;padding:6px;cursor:pointer" id="dqBtn" data-id="${esc(lead.id)}">✗ DQ</button>
        <button style="flex:1;background:#0f2540;border:1px solid #1d4ed8;border-radius:6px;color:#93c5fd;font-size:11px;font-weight:600;padding:6px;cursor:pointer" id="bookCalBtn" data-id="${esc(lead.id)}">📅 Book a Call</button>
      </div>

      <div class="outreach-nav">
        <button class="nav-btn" id="prevBtn" ${outreachIdx === 0 ? "disabled" : ""}>← Prev</button>
        <div class="snooze-group">
          <span class="snooze-label">Snooze:</span>
          <button class="snooze-btn" data-days="1">+1d</button>
          <button class="snooze-btn" data-days="3">+3d</button>
          <button class="snooze-btn" data-days="7">+1w</button>
        </div>
        <button class="nav-btn" id="nextBtn" ${outreachIdx >= queue.length - 1 ? "disabled" : ""}>Next →</button>
      </div>
    </div>
  `;

  // Copy opener
  const copyOpenerBtn = document.getElementById("copyOpenerBtn");
  if (copyOpenerBtn) {
    copyOpenerBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(opener);
      copyOpenerBtn.textContent = "✓";
      setTimeout(() => (copyOpenerBtn.textContent = "Copy"), 1500);
    });
  }

  // Generate AI opener
  const generateAiBtn = document.getElementById("generateAiBtn");
  if (generateAiBtn) {
    generateAiBtn.addEventListener("click", async () => {
      generateAiBtn.textContent = "Generating…";
      generateAiBtn.disabled = true;
      try {
        const res = await fetch(`${dashboardUrl}/api/ai/research-lead`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ leadId: lead.id }) });
        if (!res.ok) throw new Error("research-lead failed");
        await chrome.runtime.sendMessage({ type: "REFRESH_CACHE" });
        await loadData();
      } catch {
        generateAiBtn.textContent = "✨ Generate Opener";
        generateAiBtn.disabled = false;
      }
    });
  }

  // Open + copy opener
  const openSendBtn = document.getElementById("openSendBtn");
  if (openSendBtn) {
    openSendBtn.addEventListener("click", () => {
      if (opener) navigator.clipboard.writeText(opener).catch(() => {});
      openInIgTab(openSendBtn.dataset.url);
      // Auto-mark LinkedIn channel sent when clicking Open LinkedIn
      if (outreachChannel === "linkedin" && lead.id) {
        const updated = { ...(lead.outreach_channels || {}), linkedin: { sent: true, sentAt: Date.now() } };
        chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { outreach_channels: updated } }).catch(() => {});
      }
    });
  }

  // Touch chips — toggle in-memory state AND persist to backend
  document.getElementById("fbChip")?.addEventListener("click", () => {
    const newVal = !getChannelDone(lead.id).fb;
    setChannelDone(lead.id, "fb", newVal);
    if (newVal && lead.id) {
      const updated = { ...(lead.outreach_channels || {}), ig_fanbasis: { sent: true, sentAt: Date.now() } };
      chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { outreach_channels: updated } }).catch(() => {});
    }
    renderOutreach();
  });
  document.getElementById("persChip")?.addEventListener("click", () => {
    const newVal = !getChannelDone(lead.id).pers;
    setChannelDone(lead.id, "pers", newVal);
    if (newVal && lead.id) {
      const updated = { ...(lead.outreach_channels || {}), ig_personal: { sent: true, sentAt: Date.now() } };
      chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { outreach_channels: updated } }).catch(() => {});
    }
    renderOutreach();
  });

  // Mark DM Sent — advance stage + persist channel sent
  document.getElementById("markSentBtn").addEventListener("click", async (e) => {
    const btn = e.currentTarget;
    if (btn.disabled) return;
    btn.textContent = "Saving…";
    btn.disabled = true;
    const due = new Date(Date.now() + 3 * 24 * 3600000).toISOString();
    const chKey = outreachChannel === "linkedin" ? "linkedin" : "ig_fanbasis";
    const chUpdate = { [chKey]: { sent: true, sentAt: Date.now() } };
    const result = await chrome.runtime.sendMessage({
      type: "UPDATE_LEAD",
      id: btn.dataset.id,
      updates: { stage: "DM Sent", last_contact_at: new Date().toISOString(), due_at: due, outreach_channels: { ...(lead.outreach_channels || {}), ...chUpdate } },
    });
    if (result?.ok === false) {
      btn.textContent = "✓ DM Sent";
      btn.disabled = false;
      return;
    }
    delete fbChannelDone[lead.id];
    await loadData();
  });

  // DQ
  document.getElementById("dqBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("dqBtn");
    if (!btn) return;
    if (btn.dataset.undoing) {
      clearTimeout(Number(btn.dataset.timer));
      delete btn.dataset.undoing;
      btn.textContent = "✗ DQ";
      btn.style.cssText = "flex:1;background:#161616;border:1px solid #7f1d1d;border-radius:6px;color:#ef4444;font-size:11px;font-weight:600;padding:6px;cursor:pointer";
      return;
    }
    btn.dataset.undoing = "1";
    btn.textContent = "↩ Undo";
    btn.style.cssText = "flex:1;background:#1a1a1a;border:1px solid #444;border-radius:6px;color:#888;font-size:11px;font-weight:600;padding:6px;cursor:pointer";
    btn.dataset.timer = setTimeout(async () => {
      delete btn.dataset.undoing;
      btn.textContent = "DQ'd"; btn.disabled = true;
      await chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { stage: "DQ" } });
      delete fbChannelDone[lead.id];
      await loadData();
    }, 4000);
  });

  // Book a Call — use Google Calendar slots if connected, else open calendar URL
  document.getElementById("bookCalBtn")?.addEventListener("click", async () => {
    const btn = document.getElementById("bookCalBtn");
    btn.textContent = "Checking…";
    btn.disabled = true;
    const slotResult = await chrome.runtime.sendMessage({ type: "GET_CALENDAR_SLOTS" }).catch(() => null);
    btn.textContent = "📅 Book a Call";
    btn.disabled = false;

    if (slotResult?.ok && slotResult.slots && slotResult.slots.length) {
      // Show inline slot picker in the sidepanel outreach card
      const outreachCard = btn.closest(".outreach-card") || btn.parentElement;
      showSidepanelSlotPicker(outreachCard, lead, slotResult.slots, slotResult.slotMins);
    } else {
      // Fallback: open calendar URL if configured — only advance stage if something actually opened
      if (calendarUrl) {
        window.open(calendarUrl, "_blank");
        await chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { stage: "Call Offered" } }).catch(() => null);
        await loadData();
      } else {
        btn.textContent = "⚠ No calendar connected";
        setTimeout(() => { btn.textContent = "📅 Book a Call"; }, 2000);
      }
    }
  });

  // Prev / Next
  document.getElementById("prevBtn")?.addEventListener("click", () => {
    outreachIdx = Math.max(0, outreachIdx - 1);
    renderOutreach();
  });
  document.getElementById("nextBtn")?.addEventListener("click", () => {
    outreachIdx = Math.min(queue.length - 1, outreachIdx + 1);
    renderOutreach();
  });

  // Snooze buttons
  list.querySelectorAll(".snooze-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await snoozeLeadLocal(lead.id, parseInt(btn.dataset.days));
      renderOutreach();
    });
  });

  // Start poll if AI is still generating
  if (isPending) startResearchPoll(lead.id);
}

// ── Scripts tab ───────────────────────────────────────────────────────────────

const catSelect = document.getElementById("scriptCategory");
const scriptListEl = document.getElementById("scriptList");

function renderScripts() {
  if (!catSelect.options.length) {
    Object.keys(SCRIPTS).forEach((cat) => {
      const opt = document.createElement("option");
      opt.value = cat;
      opt.textContent = cat;
      catSelect.appendChild(opt);
    });
  }
  const cat = catSelect.value;
  scriptListEl.innerHTML = (SCRIPTS[cat] || []).map((s) => `
    <div class="script-item">
      <div class="script-label">${esc(s.label)}</div>
      <p class="script-text">${esc(s.text)}</p>
      <button class="copy-btn script-copy" data-text="${encodeURIComponent(s.text)}">Copy</button>
    </div>
  `).join("");

  scriptListEl.querySelectorAll(".script-copy").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(decodeURIComponent(btn.dataset.text));
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy"), 1500);
    });
  });
}
catSelect.addEventListener("change", renderScripts);

// ── Filter pills ──────────────────────────────────────────────────────────────

document.querySelectorAll(".filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.filter;
    renderLeads();
  });
});

// ── Quick add lead ────────────────────────────────────────────────────────────

document.getElementById("trackBtn").addEventListener("click", async () => {
  const nameInput = document.getElementById("trackName");
  const source = document.getElementById("trackSource").value;
  const raw = nameInput.value.trim();
  if (!raw) return;

  const igUsername = source === "IG" && raw.startsWith("@") ? raw.slice(1) : undefined;

  await fetch(`${dashboardUrl}/api/leads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: raw.replace("@", ""),
      ig_username: igUsername || undefined,
      source,
      stage: "New",
      mode: "sales",
      ig_events: [],
      tags: [],
    }),
  }).catch(() => {});

  nameInput.value = "";
  await loadData();
});

// ── Load data ─────────────────────────────────────────────────────────────────

async function loadData() {
  document.getElementById("syncDot").className = "sync-dot syncing";

  const { dashboardUrl: url, fanbasisHandle: fbHandle = "", personalIgUsername: persHandle = "", calendarUrl: calUrl = "" } = await new Promise((r) =>
    chrome.storage.sync.get({ dashboardUrl: DEFAULT_URL, fanbasisHandle: "", personalIgUsername: "", calendarUrl: "" }, r)
  );
  dashboardUrl = url;
  fanbasisHandle = fbHandle;
  personalIgUsername = persHandle;
  calendarUrl = calUrl;

  await loadSnoozedLeads();
  await updateAccountPill();

  const [leadsResp, notifsResp] = await Promise.all([
    new Promise((r) => chrome.runtime.sendMessage({ type: "GET_LEADS" }, r)),
    new Promise((r) => chrome.runtime.sendMessage({ type: "GET_NOTIFICATIONS" }, r)),
  ]);

  allLeads = (leadsResp?.leads ?? []).sort((a, b) => {
    const order = { overdue: 0, today: 1, upcoming: 2, booked: 3, archived: 4 };
    return (order[urgency(a)] ?? 5) - (order[urgency(b)] ?? 5);
  });

  notifications = notifsResp?.notifications ?? [];
  overdueLeads = notifsResp?.overdue ?? [];

  // Update inbox badge
  const total = notifications.length + overdueLeads.length;
  const badge = document.getElementById("inboxBadge");
  badge.textContent = total;
  badge.style.display = total > 0 ? "inline" : "none";

  document.getElementById("syncDot").className = "sync-dot synced";

  renderActiveTab();
}

// ── Controls ──────────────────────────────────────────────────────────────────

document.getElementById("openDashboard").addEventListener("click", async () => {
  const { dashboardUrl: url } = await new Promise((r) =>
    chrome.storage.sync.get({ dashboardUrl: DEFAULT_URL }, r)
  );
  chrome.tabs.create({ url });
});

document.getElementById("refreshBtn").addEventListener("click", async () => {
  document.getElementById("syncDot").className = "sync-dot syncing";
  await chrome.runtime.sendMessage({ type: "REFRESH_CACHE" });
  await loadData();
});

// ── Settings ──────────────────────────────────────────────────────────────────

chrome.storage.sync.get({ dashboardUrl: DEFAULT_URL, igSecret: "", fanbasisHandle: "", personalIgUsername: "", calendarUrl: "" }, ({ dashboardUrl: url, igSecret, fanbasisHandle: fbH, personalIgUsername: persH, calendarUrl: calUrl }) => {
  document.getElementById("settingsDashboardUrl").value = url;
  if (igSecret) document.getElementById("settingsIgSecret").value = igSecret;
  if (fbH) document.getElementById("settingsFbHandle").value = fbH;
  if (persH) document.getElementById("settingsPersonalHandle").value = persH;
  if (calUrl) document.getElementById("settingsCalendarUrl").value = calUrl;
});

document.getElementById("saveSettings").addEventListener("click", () => {
  const url = document.getElementById("settingsDashboardUrl").value.trim().replace(/\/$/, "");
  const secret = document.getElementById("settingsIgSecret").value.trim();
  const fbH = document.getElementById("settingsFbHandle").value.trim().replace(/^@/, "");
  const persH = document.getElementById("settingsPersonalHandle").value.trim().replace(/^@/, "");
  const calUrl = document.getElementById("settingsCalendarUrl").value.trim().replace(/\/$/, "");
  chrome.storage.sync.set({ dashboardUrl: url || DEFAULT_URL, igSecret: secret, fanbasisHandle: fbH, personalIgUsername: persH, calendarUrl: calUrl }, () => {
    fanbasisHandle = fbH;
    personalIgUsername = persH;
    calendarUrl = calUrl;
    updateAccountPill();
    const ind = document.getElementById("settingsSaved");
    ind.style.display = "inline";
    setTimeout(() => (ind.style.display = "none"), 2000);
  });
});

// ── Init ──────────────────────────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes) => {
  if (changes.fb_cache) loadData();
  if (changes.activeIgAccount) updateAccountPill();
});

// Refresh when returning from Instagram (e.g., after sending a DM)
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") loadData();
});

// Real-time sync from the floating IG card

chrome.runtime.onMessage.addListener((msg) => {
  if (msg.type === "FB_PROFILE_ACTIVE" && msg.username) {
    // Mini card loaded a profile — sync outreach card to that lead.
    // Use allLeads (not buildOutreachQueue) so done-stage leads (just DM'd, Replied, etc.)
    // still sync — they leave the outreach queue but the user may still be on their profile.
    const username = msg.username.toLowerCase();
    const queue = buildOutreachQueue(outreachChannel);
    const queueIdx = queue.findIndex(l => (l.ig_username || "").toLowerCase() === username);
    if (queueIdx !== -1 && queueIdx !== outreachIdx) {
      outreachIdx = queueIdx;
      if (activeTab === "outreach") renderOutreach();
    }
  }
  if (msg.type === "FB_DM_SENT") {
    // Show "Updating…" immediately so the card isn't interactive while stale data loads
    if (activeTab === "outreach") {
      const list = document.getElementById("outreachList");
      if (list) list.innerHTML = `<div style="padding:24px;text-align:center;color:#475569;font-size:12px">Updating…</div>`;
    }
    loadData().then(() => {
      if (activeTab === "outreach") renderOutreach();
    });
  }
});

loadData().then(() => {
  // On cold open, recover the last active IG profile so the outreach card syncs
  // even if the user opened the sidepanel without navigating (no onUpdated fires)
  chrome.storage.local.get({ lastIgEvent: null }, ({ lastIgEvent }) => {
    if (!lastIgEvent || lastIgEvent.type !== "FB_PROFILE_ACTIVE" || !lastIgEvent.username) return;
    if (Date.now() - (lastIgEvent.ts || 0) > 30 * 60 * 1000) return; // ignore stale > 30 min
    const username = lastIgEvent.username.toLowerCase();
    const queue = buildOutreachQueue(outreachChannel);
    const idx = queue.findIndex(l => (l.ig_username || "").toLowerCase() === username);
    if (idx !== -1) {
      outreachIdx = idx;
      if (activeTab === "outreach") renderOutreach();
    }
  });
});

// ── Google Calendar settings ──────────────────────────────────────────────────

async function calInitSettings() {
  const { cal_calendars: calendars = null } = await new Promise(r =>
    chrome.storage.local.get({ cal_calendars: null }, r)
  );
  const { cal_selected: selected = [], cal_slot_mins: slotMins = 45 } = await new Promise(r =>
    chrome.storage.sync.get({ cal_selected: [], cal_slot_mins: 45 }, r)
  );

  if (calendars) {
    document.getElementById("calDisconnected").style.display = "none";
    document.getElementById("calConnected").style.display = "block";
    const primary = calendars.find(c => c.primary);
    if (primary) {
      document.getElementById("calConnectedAs").innerHTML =
        `<span style="width:6px;height:6px;border-radius:50%;background:#22c55e;display:inline-block"></span> ${primary.summary || primary.id}`;
    }
    const wrap = document.getElementById("calListWrap");
    wrap.innerHTML = "";
    calendars.forEach(cal => {
      const isSelected = selected.includes(cal.id);
      const row = document.createElement("div");
      row.style.cssText = "display:flex;align-items:center;gap:8px;padding:5px 8px;border-radius:5px;background:#13131a;border:1px solid #1e1e2a;cursor:pointer";
      row.innerHTML = `
        <input type="checkbox" data-cal-id="${cal.id}" ${isSelected ? "checked" : ""} style="accent-color:#4285F4;cursor:pointer">
        <span style="font-size:11px;color:${isSelected ? "#ddd" : "#666"}">${cal.summary || cal.id}${cal.primary ? ' <span style="font-size:9px;color:#4285F4;font-weight:700">PRIMARY</span>' : ""}</span>
      `;
      row.querySelector("input").addEventListener("change", function() {
        row.querySelector("span").style.color = this.checked ? "#ddd" : "#666";
      });
      row.addEventListener("click", (e) => {
        if (e.target.tagName !== "INPUT") {
          const cb = row.querySelector("input");
          cb.checked = !cb.checked;
          row.querySelector("span").style.color = cb.checked ? "#ddd" : "#666";
        }
      });
      wrap.appendChild(row);
    });
    document.getElementById("calSlotMins").value = String(slotMins);
  } else {
    document.getElementById("calDisconnected").style.display = "block";
    document.getElementById("calConnected").style.display = "none";
  }
}

document.getElementById("calConnectBtn")?.addEventListener("click", async () => {
  const btn = document.getElementById("calConnectBtn");
  btn.textContent = "Connecting…";
  btn.disabled = true;
  const result = await chrome.runtime.sendMessage({ type: "CONNECT_CALENDAR" }).catch(() => null);
  btn.textContent = "Connect Google Calendar";
  btn.disabled = false;
  if (result?.ok) {
    await calInitSettings();
  } else {
    const note = document.getElementById("calClientIdNote");
    if (note) note.style.display = "block";
    btn.style.borderColor = "#7f1d1d";
    btn.style.color = "#ef4444";
    setTimeout(() => {
      btn.style.borderColor = "#1d4ed8";
      btn.style.color = "#93c5fd";
    }, 3000);
  }
});

document.getElementById("calDisconnectBtn")?.addEventListener("click", async () => {
  await chrome.runtime.sendMessage({ type: "DISCONNECT_CALENDAR" }).catch(() => {});
  document.getElementById("calDisconnected").style.display = "block";
  document.getElementById("calConnected").style.display = "none";
});

document.getElementById("calSaveBtn")?.addEventListener("click", async () => {
  const checkboxes = document.querySelectorAll("#calListWrap input[type=checkbox]");
  const selected = [...checkboxes].filter(cb => cb.checked).map(cb => cb.dataset.calId);
  const slotMins = parseInt(document.getElementById("calSlotMins").value, 10);
  await chrome.runtime.sendMessage({ type: "SAVE_CALENDAR_SETTINGS", selected, slotMins }).catch(() => {});
  const saved = document.getElementById("calSaved");
  if (saved) { saved.style.display = "block"; setTimeout(() => (saved.style.display = "none"), 2000); }
});

calInitSettings();
