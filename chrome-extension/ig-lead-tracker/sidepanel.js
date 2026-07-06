// FanBasis sidepanel — unified lead pipeline + notifications
"use strict";

const DEFAULT_URL = "https://unified-sales-ops.vercel.app";

// ── Display timezone (shared contract with instagram.js / TZ_T1) ──────────────
const FB_TZS = [
  { id: "America/New_York", label: "ET" },
  { id: "America/Chicago",  label: "CT" },
  { id: "America/Denver",   label: "MT" },
  { id: "America/Los_Angeles", label: "PT" },
];
function fbTzLabel(id) { return (FB_TZS.find(t => t.id === id) || FB_TZS[0]).label; }
function fbFmtTime(iso, tz) {
  const p = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit", hour12: true }).formatToParts(new Date(iso));
  const g = t => p.find(x => x.type === t)?.value || "";
  const m = g("minute");
  return `${m === "00" ? g("hour") : `${g("hour")}:${m}`} ${g("dayPeriod")}`;
}
function fbFmtDay(iso, tz) { return new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }).format(new Date(iso)); }
function fbDayKey(iso, tz) { return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso)); }

let allLeads = [];
let overdueLeads = [];
let activeTab = "outreach";
let dashboardUrl = DEFAULT_URL;
let repToken = "";

function repAuthHeader() {
  return repToken ? { Authorization: `Bearer ${repToken}` } : {};
}

// C5: PATCH /api/leads/:id — direct field updates (stage, notes, due_at)
async function apiPatchLead(leadId, updates) {
  try {
    const res = await fetch(`${dashboardUrl}/api/leads/${leadId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", ...repAuthHeader() },
      body: JSON.stringify(updates),
    });
    if (!res.ok) throw new Error(String(res.status));
    chrome.runtime.sendMessage({ type: "REFRESH_CACHE" }).catch(() => {});
    return true;
  } catch {
    return false;
  }
}

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

const ALL_STAGES = ["New", "Warming", "DM Sent", "Replied", "Qualifying", "Call Offered", "Booked", "Closed", "DQ"];

function stageColor(stage) {
  const c = {
    "New": "#64748b", "Warming": "#f59e0b", "DM Sent": "#3b82f6",
    "Replied": "#8b5cf6", "Qualifying": "#06b6d4",
    "Call Offered": "#10b981", "Booked": "#22c55e",
    "Closed": "#475569", "DQ": "#ef4444",
  };
  return c[stage] || "#64748b";
}

// C7: canonical IG profile URL from a handle
function igProfileUrl(handle) {
  return handle ? `https://www.instagram.com/${String(handle).replace(/^@/, "")}/` : null;
}

function igUrl(lead) {
  return lead.ig_profile_url || igProfileUrl(lead.ig_username);
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
  if (activeTab === "followups") renderFollowups();
  else if (activeTab === "scripts") renderScripts();
  else if (activeTab === "links") renderLinks();
  else renderOutreach();
}

// ── Follow-ups tab — overdue follow-ups only (replies stay as Chrome notifications) ──

function renderFollowups() {
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

  if (!items.length) {
    list.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">🚀</div>
        <p>Nothing due yet</p>
        <span>Follow-ups show up here once leads are in motion. Right now, focus on new volume in Outreach.</span>
      </div>`;
    return;
  }

  list.innerHTML = items.join("");

  list.querySelectorAll(".open-btn").forEach((btn) => {
    btn.addEventListener("click", () => openInIgTab(btn.dataset.url));
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
  // Legacy local snoozes (pre-2.3.0) — still honored until they expire, but no new
  // writes: snooze is server-side now (C4) and reads from the lead's `snoozed_until`.
  const { fb_snoozed = {} } = await chrome.storage.local.get({ fb_snoozed: {} });
  const now = Date.now();
  snoozedLeads = Object.fromEntries(Object.entries(fb_snoozed).filter(([, ts]) => ts > now));
}

// C4: POST /api/leads/:id/snooze — persists across devices and shows on the dashboard
async function snoozeLeadServer(leadId, days) {
  const until = new Date(Date.now() + days * 24 * 3600 * 1000).toISOString();
  const res = await chrome.runtime.sendMessage({ type: "SNOOZE_LEAD", id: leadId, until }).catch(() => null);
  if (res?.ok) {
    const target = allLeads.find((l) => l.id === leadId);
    if (target) target.snoozed_until = until;
  }
  return !!res?.ok;
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
  return window.FBQueue.buildQueue(allLeads, { channel, snoozed: snoozedLeads });
}

// AE selection (who the discovery call is with) — shared with the IG content
// script via chrome.storage.sync so the rep picks once.
async function loadAeState() {
  const res = await chrome.runtime.sendMessage({ type: "GET_AES" }).catch(() => null);
  const aes = res?.ok ? res.aes || [] : [];
  let aeId = null;
  if (aes.length) {
    const stored = (await chrome.storage.sync.get("selectedAeId").catch(() => ({}))).selectedAeId;
    aeId = (stored === "" || aes.some(a => a.id === stored)) ? stored : aes[0].id;
  }
  return { aes, aeId };
}

// mode "book" (default) = full booking flow; mode "avail" = look-don't-book:
// pick up to 3 open times (across days) and copy them / a ready DM to offer.
function showSidepanelSlotPicker(_container, lead, slots, slotMins, aes, aeId, initialError, mode) {
  mode = mode || "book";
  const offering = mode === "avail";
  slotMins = slotMins || 45;
  aes = aes || [];
  let currentAeId = aeId || null;
  const leadName = lead?.name || (lead?.ig_username ? `@${lead.ig_username}` : "Lead");
  const aeName = () => aes.find(a => a.id === currentAeId)?.name || null;
  const offerPicks = []; // availability mode: slots chosen to offer (max 3)
  let lateTimes = false; // calls normally end by 6:15 PM; override extends to 8 PM
  let displayTz = "America/New_York";
  let currentSlots = slots || [];   // raw flat list, for regrouping on zone change

  // Group slots by date key "YYYY-MM-DD" in the display zone (the raw ISO string
  // is UTC — splitting it puts evening slots under the wrong day).
  function localKey(iso) { return fbDayKey(iso, displayTz); }
  function groupSlots(list) {
    const m = {};
    (list || []).forEach(s => { const k = localKey(s.start); (m[k] = m[k] || []).push(s); });
    return m;
  }
  let slotsByDate = groupSlots(slots);
  let availDates = new Set(Object.keys(slotsByDate));

  const overlay = document.getElementById("sp-book-overlay");
  const modal = document.getElementById("sp-book-modal");
  const body = document.getElementById("sp-book-body");
  const titleEl = document.getElementById("sp-book-title");
  const subtitleEl = document.getElementById("sp-book-subtitle");
  const stepEls = [
    document.getElementById("sp-step-1"),
    document.getElementById("sp-step-2"),
    document.getElementById("sp-step-3"),
  ];

  titleEl.textContent = offering ? "See Availability" : "Book a Call";
  subtitleEl.textContent = offering ? `offer times · ${esc(leadName)}` : `${slotMins} min · ${esc(leadName)}`;
  document.getElementById("sp-book-close").onclick = () => { overlay.style.display = "none"; };
  overlay.onclick = (e) => { if (e.target === overlay) overlay.style.display = "none"; };

  // ── AE bar — whose real availability the calendar shows ──
  let aeBar = document.getElementById("sp-ae-bar");
  if (!aeBar) {
    aeBar = document.createElement("div");
    aeBar.id = "sp-ae-bar";
    aeBar.className = "sp-ae-bar";
    modal.insertBefore(aeBar, body);
  }
  function renderAeBar() {
    const aeSelect = aes.length ? `
      <span style="font-size:11px;color:#475569;flex-shrink:0">Call with</span>
      <select id="sp-ae-select" class="sp-ae-select" aria-label="Account Executive for this call">
        <option value="" ${!currentAeId ? "selected" : ""}>Me (my calendar)</option>
        ${aes.map(a => `<option value="${a.id}" ${a.id === currentAeId ? "selected" : ""}>${esc(a.name)}</option>`).join("")}
      </select>` : "";
    aeBar.innerHTML = `${aeSelect}
      <select id="sp-tz-select" class="sp-ae-select" style="flex:0 0 auto;min-width:52px" aria-label="Timezone">
        ${FB_TZS.map(t => `<option value="${t.id}" ${t.id === displayTz ? "selected" : ""}>${t.label}</option>`).join("")}
      </select>
      <button id="sp-late-toggle" class="sp-late-toggle${lateTimes ? " on" : ""}"
        title="Calls normally end by 6:15 PM — allow up to 8 PM">🌙 Late</button>`;
    const sel = document.getElementById("sp-ae-select");
    if (sel) sel.onchange = (e) => switchAe(e.target.value);
    document.getElementById("sp-tz-select").onchange = (e) => applyTz(e.target.value);
    document.getElementById("sp-late-toggle").onclick = () => {
      lateTimes = !lateTimes;
      renderAeBar();
      refetchSlots();
    };
  }
  renderAeBar();

  async function refetchSlots() {
    offerPicks.length = 0; // picked times belong to the previous slot window
    setStep(1);
    body.innerHTML = `<div style="padding:34px 0;text-align:center;color:#475569;font-size:12px">Checking ${esc(aeName() || "your")}${aeName() ? "’s" : ""} live availability…</div>`;
    const res = await chrome.runtime.sendMessage({ type: "GET_CALENDAR_SLOTS", aeId: currentAeId, late: lateTimes }).catch(() => null);
    if (res?.ok) {
      currentSlots = res.slots;
      slotsByDate = groupSlots(currentSlots);
      availDates = new Set(Object.keys(slotsByDate));
      renderCalendar();
    } else if (res?.error === "ae_calendar_unreadable") {
      renderUnreadable();
    } else {
      body.innerHTML = `<div style="padding:34px 0;text-align:center;color:#475569;font-size:12px">Couldn’t load availability — close and try again.</div>`;
    }
  }

  async function switchAe(id) {
    currentAeId = id;
    chrome.storage.sync.set({ selectedAeId: id }).catch(() => {});
    await refetchSlots();
  }

  function applyTz(newTz) {
    if (!FB_TZS.some(t => t.id === newTz)) return;
    displayTz = newTz;
    chrome.storage.sync.set({ fbDisplayTz: newTz }).catch(() => {});
    slotsByDate = groupSlots(currentSlots);
    availDates = new Set(Object.keys(slotsByDate));
    renderAeBar();
    renderCalendar();   // return to calendar; availDates now keyed in the new zone
  }

  function renderUnreadable() {
    setStep(1);
    body.innerHTML = `
      <div style="padding:26px 8px;text-align:center">
        <div style="font-size:13px;font-weight:700;color:#E2E8F0;margin-bottom:8px">Can’t see ${esc(aeName() || "this AE")}’s calendar</div>
        <div style="font-size:11.5px;line-height:1.5;color:#475569">Their Google Calendar isn’t sharing free/busy with your account. Ask them to enable it, or pick a different AE above.</div>
      </div>`;
  }

  function setStep(n) {
    stepEls.forEach((s, i) => s.classList.toggle("active", i < n));
  }

  function fmtTime(iso) {
    return fbFmtTime(iso, displayTz);
  }

  const today = new Date();
  let viewYear = today.getFullYear(), viewMonth = today.getMonth();
  const MONTHS = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const MONTHS_SHORT = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const DAYS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  // ── Availability mode: offer-times text + footer ──
  function fmtOffer(iso) {
    const d = new Date(iso);
    return `${DAYS[d.getDay()]} ${MONTHS_SHORT[d.getMonth()]} ${d.getDate()} at ${fmtTime(iso)}`;
  }
  function offerTimesText() {
    const t = offerPicks.slice().sort((a, b) => new Date(a.start) - new Date(b.start)).map(s => fmtOffer(s.start));
    if (t.length <= 1) return t[0] || "";
    if (t.length === 2) return `${t[0]} or ${t[1]}`;
    return `${t.slice(0, -1).join(", ")}, or ${t[t.length - 1]}`;
  }
  function offerDmText() {
    const first = (lead?.name || "").trim().split(/\s+/)[0];
    return `Hey${first ? ` ${first}` : ""} — happy to walk through the dashboard, no pitch, just ${slotMins} min to show you what it looks like with your numbers.\n\n${aeName() ? "We're" : "I'm"} open ${offerTimesText()} ${fbTzLabel(displayTz)} — any of those work?`;
  }
  function offerFooterHtml() {
    if (!offering) return "";
    if (!offerPicks.length) {
      return `<div style="margin-top:12px;padding-top:10px;border-top:1px solid #1A2235;font-size:11px;color:#475569;text-align:center">Pick up to 3 times to offer — across any days.</div>`;
    }
    return `
      <div style="margin-top:12px;padding-top:10px;border-top:1px solid #1A2235">
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">
          ${offerPicks.map((p, i) => `<button class="sp-offer-chip" data-i="${i}" title="Remove" style="padding:4px 8px;border-radius:7px;font-size:10.5px;font-weight:600;background:rgba(255,58,105,0.1);border:1px solid rgba(255,58,105,0.35);color:#FF7A9C;cursor:pointer">${fmtOffer(p.start)} ✕</button>`).join("")}
        </div>
        <div style="display:flex;gap:7px">
          <button id="sp-copy-times" style="flex:1;padding:9px;border-radius:9px;font-size:11px;font-weight:700;background:#151B2E;border:1px solid #2A3554;color:#94A3B8;cursor:pointer">Copy times</button>
          <button id="sp-copy-offer-dm" style="flex:1;padding:9px;border-radius:9px;font-size:11px;font-weight:700;background:#FF3A69;border:none;color:#fff;cursor:pointer">Copy DM</button>
        </div>
      </div>`;
  }
  function bindOfferFooter(rerender) {
    if (!offering) return;
    body.querySelectorAll(".sp-offer-chip").forEach(chip => {
      chip.addEventListener("click", () => { offerPicks.splice(parseInt(chip.dataset.i, 10), 1); rerender(); });
    });
    const ct = document.getElementById("sp-copy-times");
    const cd = document.getElementById("sp-copy-offer-dm");
    if (ct) ct.addEventListener("click", async () => {
      await navigator.clipboard.writeText(offerTimesText() + " " + fbTzLabel(displayTz)).catch(() => {});
      ct.textContent = "✓ Copied!"; ct.style.color = "#4ade80";
    });
    if (cd) cd.addEventListener("click", async () => {
      await navigator.clipboard.writeText(offerDmText()).catch(() => {});
      cd.textContent = "✓ Copied!";
    });
  }

  function renderCalendar() {
    setStep(1);
    const firstDay = new Date(viewYear, viewMonth, 1).getDay();
    const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
    const todayKey = `${today.getFullYear()}-${String(today.getMonth()+1).padStart(2,"0")}-${String(today.getDate()).padStart(2,"0")}`;

    let html = `
      <div class="sp-cal-nav">
        <button id="sp-cal-prev">‹</button>
        <span class="sp-cal-month">${MONTHS[viewMonth]} ${viewYear}</span>
        <button id="sp-cal-next">›</button>
      </div>
      <div class="sp-cal-grid">
        ${["S","M","T","W","T","F","S"].map(d => `<div class="sp-cal-day-hdr">${d}</div>`).join("")}
        ${Array(firstDay).fill("<div></div>").join("")}`;

    for (let day = 1; day <= daysInMonth; day++) {
      const key = `${viewYear}-${String(viewMonth+1).padStart(2,"0")}-${String(day).padStart(2,"0")}`;
      const isPast = new Date(viewYear, viewMonth, day) < new Date(today.getFullYear(), today.getMonth(), today.getDate());
      const hasSlots = availDates.has(key) && !isPast;
      const isToday = key === todayKey;
      const cls = ["sp-cal-day", isToday ? "today" : "", !hasSlots ? "disabled" : ""].filter(Boolean).join(" ");
      const dot = hasSlots ? `<span style="position:absolute;bottom:1px;left:50%;transform:translateX(-50%);width:4px;height:4px;border-radius:50%;background:#FF3A69"></span>` : "";
      html += `<button class="${cls}" data-key="${key}" style="position:relative" ${!hasSlots ? "disabled" : ""}>${day}${dot}</button>`;
    }
    html += `</div>` + offerFooterHtml();
    body.innerHTML = html;

    document.getElementById("sp-cal-prev").onclick = () => {
      if (--viewMonth < 0) { viewMonth = 11; viewYear--; }
      renderCalendar();
    };
    document.getElementById("sp-cal-next").onclick = () => {
      if (++viewMonth > 11) { viewMonth = 0; viewYear++; }
      renderCalendar();
    };
    body.querySelectorAll(".sp-cal-day:not(.disabled)").forEach(btn => {
      btn.addEventListener("click", () => renderSlots(btn.dataset.key));
    });
    bindOfferFooter(renderCalendar);
  }

  function renderSlots(dateKey) {
    setStep(2);
    const [y, mo, d] = dateKey.split("-").map(Number);
    const dateObj = new Date(y, mo - 1, d);
    const daySlots = slotsByDate[dateKey] || [];
    const isPicked = (s) => offerPicks.some(p => p.start === s.start);

    body.innerHTML = `
      <button class="sp-back-btn" id="sp-slots-back">‹ Back</button>
      <div class="sp-day-group">
        <div class="sp-day-label" style="margin-bottom:12px">${DAYS[dateObj.getDay()]}, ${MONTHS_SHORT[mo-1]} ${d}</div>
        <div class="sp-slots-chips">
          ${daySlots.map((s, i) => `<button class="sp-slot-chip${offering && isPicked(s) ? " selected" : ""}" data-i="${i}">${fmtTime(s.start)}</button>`).join("")}
        </div>
        <div class="sp-tz-hint">Times in ${fbTzLabel(displayTz)}</div>
      </div>` + offerFooterHtml();

    document.getElementById("sp-slots-back").onclick = renderCalendar;
    body.querySelectorAll(".sp-slot-chip").forEach(btn => {
      btn.addEventListener("click", () => {
        const slot = daySlots[parseInt(btn.dataset.i)];
        if (offering) {
          // Toggle this time in the offer list (max 3, can span days)
          const at = offerPicks.findIndex(p => p.start === slot.start);
          if (at >= 0) offerPicks.splice(at, 1);
          else if (offerPicks.length < 3) offerPicks.push(slot);
          renderSlots(dateKey);
          return;
        }
        body.querySelectorAll(".sp-slot-chip").forEach(b => b.classList.remove("selected"));
        btn.classList.add("selected");
        setTimeout(() => renderConfirm(daySlots[parseInt(btn.dataset.i)], dateKey), 160);
      });
    });
    bindOfferFooter(() => renderSlots(dateKey));
  }

  function renderConfirm(slot, dateKey) {
    setStep(3);
    const [y, mo, d] = dateKey.split("-").map(Number);
    const dateObj = new Date(y, mo - 1, d);

    body.innerHTML = `
      <div class="sp-confirm-card">
        <div class="sp-confirm-row"><span>📅</span><span>${DAYS[dateObj.getDay()]}, ${MONTHS_SHORT[mo-1]} ${d}</span></div>
        <div class="sp-confirm-row"><span>🕐</span><span>${fmtTime(slot.start)} ${fbTzLabel(displayTz)} · ${slotMins} min</span></div>
        ${aeName() ? `<div class="sp-confirm-row"><span>🎧</span><span>AE: ${esc(aeName())}</span></div>` : ""}
      </div>
      <label style="display:block;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:#475569;margin:0 0 4px">Booking for</label>
      <input id="sp-conf-name" type="text" placeholder="Their name"
        style="width:100%;padding:9px 12px;margin-bottom:8px;background:#0F1420;border:1px solid #2A3554;border-radius:8px;color:#CBD5E1;font-size:12px;outline:none;box-sizing:border-box;transition:border-color .15s">
      <input id="sp-conf-email" type="email" placeholder="Their email (optional — adds them as attendee)"
        style="width:100%;margin-bottom:12px;padding:9px 12px;background:#0F1420;border:1px solid #2A3554;border-radius:8px;color:#CBD5E1;font-size:12px;outline:none;box-sizing:border-box;transition:border-color .15s">
      <p class="sp-confirm-hint">Creates a Google Calendar event${aeName() ? `, invites ${esc(aeName())},` : ""} and marks this lead as Booked.</p>
      <button class="sp-confirm-btn" id="sp-conf-book">Confirm Booking</button>
      <button class="sp-back-btn" id="sp-conf-back" style="justify-content:center;margin-top:10px">‹ Change time</button>`;

    const nameEl = document.getElementById("sp-conf-name");
    const emailEl = document.getElementById("sp-conf-email");
    // Suggested from the lead, but fully editable — the booking is NOT locked to
    // the profile you're viewing. A real suggestion is protected; a blank one
    // auto-fills from the email as you type it (until you edit the name).
    const suggestedName = lead?.name || lead?.ig_username || "";
    nameEl.value = suggestedName;
    if (suggestedName) nameEl.dataset.edited = "1";
    nameEl.addEventListener("input", () => { nameEl.dataset.edited = "1"; });
    emailEl.addEventListener("input", () => {
      if (nameEl.dataset.edited) return;
      const local = emailEl.value.split("@")[0] || "";
      nameEl.value = local.split(/[._-]/).filter(Boolean).map((p) => p.charAt(0).toUpperCase() + p.slice(1)).join(" ");
    });
    [nameEl, emailEl].forEach((el) => {
      el.addEventListener("focus", () => { el.style.borderColor = "#3B82F6"; });
      el.addEventListener("blur", () => { el.style.borderColor = "#2A3554"; });
    });
    document.getElementById("sp-conf-back").onclick = () => renderSlots(dateKey);

    document.getElementById("sp-conf-book").addEventListener("click", async () => {
      const btn = document.getElementById("sp-conf-book");
      const guestEmail = emailEl.value.trim() || undefined;
      const bookedName = nameEl.value.trim() || lead?.name || lead?.ig_username || "Lead";
      btn.textContent = "Booking…";
      btn.disabled = true;
      const result = await chrome.runtime.sendMessage({
        type: "CREATE_CALENDAR_EVENT",
        slotStart: slot.start, slotEnd: slot.end,
        leadName: bookedName,
        guestEmail,
        aeId: currentAeId || undefined,
      }).catch(() => null);

      if (result?.error === "slot_taken") {
        // The window filled up since the slot list loaded — refresh and re-pick.
        body.innerHTML = `<div style="padding:34px 0;text-align:center;color:#fbbf24;font-size:12px">That time was just taken — refreshing availability…</div>`;
        setTimeout(() => switchAe(currentAeId), 900);
        return;
      }
      if (result?.ok) {
        await chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { stage: "Booked" } }).catch(() => {});
        const [y2, mo2, d2] = dateKey.split("-").map(Number);
        const d2Obj = new Date(y2, mo2-1, d2);
        const dmText = `Hey! Just sent a calendar invite for ${DAYS[d2Obj.getDay()]} ${MONTHS_SHORT[mo2-1]} ${d2} at ${fmtTime(slot.start)} ${fbTzLabel(displayTz)} — ${slotMins} min, no pressure. Let me know if that time works!${result?.meetLink ? `\n\nGoogle Meet: ${result.meetLink}` : ""}`;
        body.innerHTML = `
          <div class="sp-book-done">
            <div class="sp-book-done-icon">✓</div>
            <p>Call booked!</p>
            <span>${esc(bookedName)} · ${fmtTime(slot.start)}</span>
            <button id="sp-copy-dm" style="margin-top:8px;padding:8px 18px;background:#1A2235;border:1px solid #2A3554;border-radius:8px;color:#94A3B8;font-size:12px;cursor:pointer;transition:all .15s">Copy DM text</button>
          </div>`;
        document.getElementById("sp-copy-dm").addEventListener("click", async function() {
          await navigator.clipboard.writeText(dmText).catch(() => {});
          this.textContent = "✓ Copied!";
          this.style.color = "#4ade80";
          this.style.borderColor = "#166534";
        });
        setTimeout(async () => { overlay.style.display = "none"; await loadData(); }, 3500);
      } else {
        btn.textContent = "✗ Failed — try again";
        btn.style.background = "rgba(239,68,68,0.12)";
        btn.disabled = false;
      }
    });
  }

  if (initialError === "ae_calendar_unreadable") renderUnreadable();
  else renderCalendar();
  overlay.style.display = "flex";
  chrome.storage.sync.get({ fbDisplayTz: "America/New_York" }).then(r => {
    if (!r.fbDisplayTz || r.fbDisplayTz === displayTz || !FB_TZS.some(t => t.id === r.fbDisplayTz)) return;
    if (initialError === "ae_calendar_unreadable") {
      // Don't clobber the error screen — just adopt the zone for later refetches.
      displayTz = r.fbDisplayTz;
      renderAeBar();
    } else {
      applyTz(r.fbDisplayTz);
    }
  }).catch(() => {});
}

function renderOutreach() {
  // Don't clobber the notes textarea mid-typing — blur triggers a save + re-render
  if (document.activeElement && document.activeElement.id === "leadNotes") return;
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
    list.innerHTML = `
      <div class="empty-state"><div class="empty-icon">🎉</div><p>Queue cleared!</p><span>All leads done or snoozed.</span></div>
      <div style="display:flex;justify-content:center;padding:6px 0">
        <a href="#" id="allLeadsLink" style="font-size:11px;color:#475569;text-decoration:none">All leads →</a>
      </div>`;
    document.getElementById("allLeadsLink")?.addEventListener("click", (e) => {
      e.preventDefault();
      chrome.tabs.create({ url: `${dashboardUrl}/` });
    });
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

  const prog = window.FBQueue.computeBatchProgress(allLeads, { channel: outreachChannel });

  list.innerHTML = `
    <div class="queue-progress">
      <span class="queue-pos">Reached out: ${prog.contacted} / ${prog.total} (${prog.pct}%)</span>
      <div class="queue-bar-bg">
        <div class="queue-bar-fill" style="width:${prog.pct}%"></div>
      </div>
    </div>
    <div class="queue-cursor">Card ${outreachIdx + 1} of ${queue.length} to do</div>

    <div class="outreach-card flashcard">
      ${alreadyUsesBanner}
      <div class="outreach-top">
        <div class="outreach-name-row">
          <span class="outreach-name">${lead.ig_username ? `<a class="handle-link" href="${esc(igProfileUrl(lead.ig_username))}" target="_blank" rel="noreferrer">${esc(displayName(lead))}</a>` : esc(displayName(lead))}</span>
          ${lead.ig_username ? `<button class="copy-handle-btn" id="copyHandleBtn" data-handle="${esc(lead.ig_username)}" title="Copy @${esc(lead.ig_username)}">⧉</button>` : ""}
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
        <button style="flex:1;background:#151B2E;border:1px solid #2A3554;border-radius:6px;color:#94A3B8;font-size:11px;font-weight:600;padding:6px;cursor:pointer" id="availCalBtn" data-id="${esc(lead.id)}">🕐 Times</button>
        <button style="flex:1;background:#0f2540;border:1px solid #1d4ed8;border-radius:6px;color:#93c5fd;font-size:11px;font-weight:600;padding:6px;cursor:pointer" id="bookCalBtn" data-id="${esc(lead.id)}">📅 Book</button>
      </div>

      <div style="display:flex;align-items:center;gap:6px;margin-top:5px">
        <span style="font-size:10px;color:#475569;flex-shrink:0">Stage:</span>
        <select class="stage-select" id="outreachStageSelect" style="flex:1;color:${stageColor(lead.stage)};border-color:${stageColor(lead.stage)}44">
          ${ALL_STAGES.map((s) => `<option value="${s}" ${lead.stage === s ? "selected" : ""}>${s}</option>`).join("")}
        </select>
      </div>

      <div class="card-notes" style="margin-top:8px">
        <textarea id="leadNotes" rows="2" placeholder="Notes… (auto-saves)">${esc(lead.notes || "")}</textarea>
      </div>
      <div style="display:flex;align-items:center;gap:5px;margin-top:5px;flex-wrap:wrap">
        <span style="font-size:10px;color:#475569;flex-shrink:0">Follow up:</span>
        ${[1, 3, 7].map((d) => `<button class="fu-btn" data-days="${d}">+${d}d</button>`).join("")}
        ${lead.due_at ? `<button class="fu-btn" id="fuClearBtn" title="Clear due date">clear</button>` : ""}
        ${lead.due_at ? `<span style="font-size:10px;color:#64748b;margin-left:auto">${esc(dueLabel(lead.due_at))}</span>` : ""}
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

    <div style="display:flex;gap:14px;justify-content:center;padding:8px 0 4px">
      <a href="#" id="allLeadsLink" style="font-size:11px;color:#475569;text-decoration:none">All leads →</a>
      <a href="#" id="openDashLeadLink" style="font-size:11px;color:#475569;text-decoration:none">Open in dashboard →</a>
    </div>
  `;

  // Quick links to the dashboard (the panel's Leads tab was cut — full list lives there)
  document.getElementById("allLeadsLink")?.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: `${dashboardUrl}/` });
  });
  document.getElementById("openDashLeadLink")?.addEventListener("click", (e) => {
    e.preventDefault();
    chrome.tabs.create({ url: `${dashboardUrl}/leads/${lead.id}` });
  });

  // Copy @handle
  const copyHandleBtn = document.getElementById("copyHandleBtn");
  if (copyHandleBtn) {
    copyHandleBtn.addEventListener("click", () => {
      navigator.clipboard.writeText(`@${copyHandleBtn.dataset.handle}`).catch(() => {});
      copyHandleBtn.textContent = "✓";
      setTimeout(() => (copyHandleBtn.textContent = "⧉"), 1200);
    });
  }

  // Full stage control (C5)
  document.getElementById("outreachStageSelect")?.addEventListener("change", async (e) => {
    const sel = e.currentTarget;
    sel.disabled = true;
    const ok = await apiPatchLead(lead.id, { stage: sel.value });
    if (!ok) {
      sel.disabled = false;
      sel.value = lead.stage;
      return;
    }
    delete fbChannelDone[lead.id];
    await loadData();
  });

  // Notes — auto-save (debounced + on blur) via PATCH /api/leads/:id { notes }
  const notesEl = document.getElementById("leadNotes");
  if (notesEl) {
    let notesTimer = null;
    const saveNotes = () => {
      const val = notesEl.value;
      if (val === (lead.notes || "")) return;
      lead.notes = val;
      apiPatchLead(lead.id, { notes: val });
    };
    notesEl.addEventListener("input", () => {
      clearTimeout(notesTimer);
      notesTimer = setTimeout(saveNotes, 800);
    });
    notesEl.addEventListener("blur", () => {
      clearTimeout(notesTimer);
      saveNotes();
    });
  }

  // Follow-up date setter — PATCH /api/leads/:id { due_at }
  list.querySelectorAll(".fu-btn[data-days]").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      const due = new Date(Date.now() + parseInt(btn.dataset.days) * 86400000).toISOString();
      await apiPatchLead(lead.id, { due_at: due });
      await loadData();
    });
  });
  document.getElementById("fuClearBtn")?.addEventListener("click", async () => {
    await apiPatchLead(lead.id, { due_at: null });
    await loadData();
  });

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
        const res = await fetch(`${dashboardUrl}/api/ai/research-lead`, { method: "POST", headers: { "Content-Type": "application/json", ...repAuthHeader() }, body: JSON.stringify({ leadId: lead.id }) });
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
    // Record the account(s) actually used — the toggled touch chips — never a
    // hardcoded ig_fanbasis. No chip marked → neutral "ig".
    const stamp = { sent: true, sentAt: Date.now() };
    let chUpdate;
    if (outreachChannel === "linkedin") {
      chUpdate = { linkedin: stamp };
    } else {
      const chipsDone = getChannelDone(lead.id);
      chUpdate = {};
      if (chipsDone.fb) chUpdate.ig_fanbasis = stamp;
      if (chipsDone.pers) chUpdate.ig_personal = stamp;
      if (!chipsDone.fb && !chipsDone.pers) chUpdate.ig = stamp;
    }
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

  // Book a Call — server-side slots via the dashboard; else open calendar URL
  // 🕐 Times = offer availability (copy times/DM); 📅 Book = create the event.
  const wireCalBtn = (id, label, mode) => {
    document.getElementById(id)?.addEventListener("click", async () => {
      const btn = document.getElementById(id);
      if (btn.dataset.connect) {
        // Second click after "Connect calendar" — re-sign-in upgrades the Google scope
        delete btn.dataset.connect;
        btn.textContent = label;
        await chrome.runtime.sendMessage({ type: "SIGN_IN" }).catch(() => {});
        await loadData();
        return;
      }
      btn.textContent = "Checking…";
      btn.disabled = true;
      const aeState = await loadAeState();
      const slotResult = await chrome.runtime.sendMessage({ type: "GET_CALENDAR_SLOTS", aeId: aeState.aeId }).catch(() => null);
      btn.textContent = label;
      btn.disabled = false;

      if (slotResult?.ok && slotResult.slots && slotResult.slots.length) {
        // Show inline slot picker in the sidepanel outreach card
        const outreachCard = btn.closest(".outreach-card") || btn.parentElement;
        showSidepanelSlotPicker(outreachCard, lead, slotResult.slots, slotResult.slotMins, aeState.aes, aeState.aeId, null, mode);
      } else if (slotResult?.error === "ae_calendar_unreadable") {
        // Open the picker anyway — the AE dropdown lets the rep switch to one
        // whose calendar IS visible.
        const outreachCard = btn.closest(".outreach-card") || btn.parentElement;
        showSidepanelSlotPicker(outreachCard, lead, [], slotResult.slotMins || 45, aeState.aes, aeState.aeId, "ae_calendar_unreadable", mode);
      } else if (slotResult?.needsCalendar || slotResult?.needsSignIn) {
        btn.dataset.connect = "1";
        btn.textContent = "🔗 Connect calendar";
      } else {
        // Fallback: open calendar URL if configured — only advance stage if something actually opened
        if (calendarUrl) {
          window.open(calendarUrl, "_blank");
          await chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id: lead.id, updates: { stage: "Call Offered" } }).catch(() => null);
          await loadData();
        } else {
          btn.textContent = "⚠ No calendar connected";
          setTimeout(() => { btn.textContent = label; }, 2000);
        }
      }
    });
  };
  wireCalBtn("availCalBtn", "🕐 Times", "avail");
  wireCalBtn("bookCalBtn", "📅 Book", "book");

  // Prev / Next — also drive the IG tab so the auto-sync re-affirms instead of snapping back
  document.getElementById("prevBtn")?.addEventListener("click", () => {
    outreachIdx = Math.max(0, outreachIdx - 1);
    const prev = queue[outreachIdx];
    const url = prev && igUrl(prev);
    if (url && outreachChannel === "ig") openInIgTab(url);
    renderOutreach();
  });
  document.getElementById("nextBtn")?.addEventListener("click", () => {
    outreachIdx = Math.min(queue.length - 1, outreachIdx + 1);
    const next = queue[outreachIdx];
    const url = next && igUrl(next);
    if (url && outreachChannel === "ig") openInIgTab(url);
    renderOutreach();
  });

  // Snooze buttons — server-side (C4)
  list.querySelectorAll(".snooze-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      btn.disabled = true;
      await snoozeLeadServer(lead.id, parseInt(btn.dataset.days));
      renderOutreach();
    });
  });

  // Start poll if AI is still generating
  if (isPending) startResearchPoll(lead.id);
}

// ── Scripts tab ───────────────────────────────────────────────────────────────

const catSelect = document.getElementById("scriptCategory");
const scriptListEl = document.getElementById("scriptList");

// Quicklinks tab — team + personal links come from the dashboard via bootstrap
// and render read-only. All management lives on the dashboard (Team Settings),
// so there are no link settings inside the extension.
function renderLinks() {
  const el = document.getElementById("linksList");
  if (!el) return;
  const row = (l) => `
    <div class="ql-row">
      <a class="ql-link" data-url="${esc(l.url)}" href="${esc(l.url)}">
        <span class="ql-label">${esc(l.label)}</span>
        <span class="ql-url">${esc((l.url || "").replace(/^https?:\/\//, ""))}</span>
      </a>
    </div>`;
  const draw = (boot) => {
    const ql = boot?.quicklinks || { team: [], personal: [] };
    const team = ql.team || [], personal = ql.personal || [];
    const dashUrl = boot?.dashboardUrl || "https://unified-sales-ops.vercel.app";
    if (!team.length && !personal.length) {
      el.innerHTML = `<div class="empty-state"><div class="empty-icon">🔗</div><p>No links yet</p><span>Add links in the dashboard → Team Settings and they'll show up here.</span></div>`;
    } else {
      el.innerHTML =
        (team.length ? `<div class="ql-section-label">Team links</div>` + team.map(row).join("") : "") +
        (personal.length ? `<div class="ql-section-label">My links</div>` + personal.map(row).join("") : "") +
        `<div style="padding:14px;text-align:center"><a href="#" id="ql-manage-link" style="font-size:11px;color:#5A6B8C;text-decoration:none">Manage links in dashboard →</a></div>`;
    }
    el.querySelectorAll(".ql-link").forEach((a) =>
      a.addEventListener("click", (e) => { e.preventDefault(); chrome.tabs.create({ url: a.dataset.url }); })
    );
    const mng = document.getElementById("ql-manage-link");
    if (mng) mng.addEventListener("click", (e) => { e.preventDefault(); chrome.tabs.create({ url: `${dashUrl}/settings/team` }); });
  };
  // Instant from cache, then refresh from the dashboard so newly-added links appear.
  chrome.storage.local.get({ fb_bootstrap: null }, ({ fb_bootstrap }) => draw(fb_bootstrap));
  chrome.runtime.sendMessage({ type: "REFRESH_BOOTSTRAP" }, (res) => { if (res?.bootstrap) draw(res.bootstrap); });
}

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

// ── Load data ─────────────────────────────────────────────────────────────────

async function loadData() {
  document.getElementById("syncDot").className = "sync-dot syncing";

  // All config self-provisions from the dashboard bootstrap (merged in background)
  const s = await chrome.runtime.sendMessage({ type: "GET_SETTINGS" }).catch(() => null) || {};
  dashboardUrl = s.dashboardUrl || DEFAULT_URL;
  fanbasisHandle = s.fanbasisHandle || "";
  personalIgUsername = s.personalIgUsername || "";
  calendarUrl = s.calendarUrl || "";
  repToken = s.repToken || "";
  renderAuth(s);

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

  // Reply notifications still fire as Chrome notifications from background.js —
  // the panel only tracks overdue follow-ups now.
  overdueLeads = notifsResp?.overdue ?? [];

  // Update follow-ups badge (overdue only)
  const total = overdueLeads.length;
  const badge = document.getElementById("inboxBadge");
  badge.textContent = total;
  badge.style.display = total > 0 ? "inline" : "none";

  document.getElementById("syncDot").className = "sync-dot synced";

  renderActiveTab();
}

// ── Controls ──────────────────────────────────────────────────────────────────

document.getElementById("openDashboard").addEventListener("click", () => {
  chrome.tabs.create({ url: dashboardUrl || DEFAULT_URL });
});

document.getElementById("refreshBtn").addEventListener("click", async () => {
  document.getElementById("syncDot").className = "sync-dot syncing";
  await chrome.runtime.sendMessage({ type: "REFRESH_CACHE" });
  await loadData();
});

// ── Auth — sign-in gate + read-only account status ────────────────────────────

function renderAuth(settings) {
  const gate = document.getElementById("signin-gate");
  const panel = document.querySelector(".panel");
  const section = document.getElementById("accountSection");
  const statusEl = document.getElementById("accountStatus");
  const signedIn = !!settings?.signedIn;

  gate.style.display = signedIn ? "none" : "flex";
  panel.style.display = signedIn ? "" : "none";
  section.style.display = signedIn ? "" : "none";
  if (!signedIn) return;

  const rep = settings.rep || {};
  const dot = (color) => `<span style="width:6px;height:6px;border-radius:50%;background:${color};display:inline-block;flex:0 0 auto"></span>`;
  const row = "display:flex;align-items:center;gap:7px;font-size:11.5px;color:#cbd5e1;padding:4px 0";
  statusEl.innerHTML = `
    <div style="${row}">${dot("#22c55e")} Signed in as ${esc(rep.name || rep.email || "rep")}
      <button id="signOutBtn" class="sp-btn" style="margin-left:auto">Sign out</button>
    </div>
    <div style="${row}">${settings.calendarConnected
      ? `${dot("#22c55e")} Calendar connected`
      : `${dot("#f59e0b")} <span style="color:#fbbf24">Calendar not connected</span>
         <button id="calReconnectBtn" class="sp-btn sp-btn-primary" style="margin-left:auto">Connect</button>`}
    </div>
    <div style="${row}">${dot("#22c55e")} Team: FanBasis${settings.fanbasisHandle ? ` <span style="color:#5c5c78">(@${esc(settings.fanbasisHandle)})</span>` : ""}</div>`;

  document.getElementById("signOutBtn").addEventListener("click", async () => {
    await chrome.runtime.sendMessage({ type: "SIGN_OUT" }).catch(() => {});
    await loadData();
  });
  // Re-running sign-in upgrades the Google grant with calendar scope
  document.getElementById("calReconnectBtn")?.addEventListener("click", async (e) => {
    e.currentTarget.textContent = "…";
    await chrome.runtime.sendMessage({ type: "SIGN_IN" }).catch(() => {});
    await loadData();
  });
}

document.getElementById("signInBtn").addEventListener("click", async () => {
  const btn = document.getElementById("signInBtn");
  const errEl = document.getElementById("signInError");
  errEl.style.display = "none";
  btn.disabled = true;
  btn.lastChild.textContent = " Opening Google…";
  const res = await chrome.runtime.sendMessage({ type: "SIGN_IN" }).catch((e) => ({ ok: false, error: e.message }));
  btn.disabled = false;
  btn.lastChild.textContent = " Sign in with Google";
  if (res?.ok) {
    await loadData();
  } else if (res?.error && res.error !== "cancelled" && !/did not approve/i.test(res.error)) {
    errEl.textContent = `⚠ Sign-in failed: ${res.error}`;
    errEl.style.display = "block";
  }
});

// ── Init ──────────────────────────────────────────────────────────────────────

chrome.storage.onChanged.addListener((changes) => {
  if (changes.fb_cache) loadData();
  if (changes.activeIgAccount) updateAccountPill();
  // Sign-in/out or a fresh bootstrap from background → refresh gate + status
  if (changes.fb_rep_token || changes.fb_bootstrap) loadData();
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


// ── Update nudge — compares installed version to the dashboard's published build
(async function checkExtensionUpdate() {
  try {
    const res = await chrome.runtime.sendMessage({ type: "CHECK_UPDATE" }).catch(() => null);
    if (!res?.ok || !res.updateAvailable) return;
    const { dashboardUrl } = await chrome.storage.sync.get({ dashboardUrl: "https://unified-sales-ops.vercel.app" });
    document.getElementById("update-banner-text").textContent =
      `Update available: v${res.latest} (you're on v${res.current})`;
    document.getElementById("update-banner-link").href = `${dashboardUrl}/settings/extension`;
    document.getElementById("update-banner").style.display = "flex";
  } catch { /* never block the panel over a version check */ }
})();
