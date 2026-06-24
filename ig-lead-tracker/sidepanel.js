// sidepanel.js

const STAGES = ["New","Warming","DM Sent","Qualifying","Call Offered","Booked","Closed","DQ"];

// ─── Tab switching ────────────────────────────────────────────────────────────
document.querySelectorAll(".tab-btn").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab-panel").forEach((p) => p.classList.add("hidden"));
    btn.classList.add("active");
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove("hidden");
  });
});

// ─── Helpers ─────────────────────────────────────────────────────────────────
function dueLabel(ts) {
  const diff = ts - Date.now();
  if (diff < 0) {
    const h = Math.floor(-diff / 3600000);
    return h < 24 ? `${h}h overdue` : `${Math.floor(h/24)}d overdue`;
  }
  const h = Math.floor(diff / 3600000);
  if (h < 24) return `due ${h}h`;
  return `due ${Math.floor(h/24)}d`;
}

async function copyText(text, btn) {
  await navigator.clipboard.writeText(text);
  const orig = btn.textContent;
  btn.textContent = "Copied!";
  btn.classList.add("copied");
  setTimeout(() => { btn.textContent = orig; btn.classList.remove("copied"); }, 1800);
}

// ─── Leads ────────────────────────────────────────────────────────────────────
async function loadLeads() {
  const { leads = [] } = await chrome.storage.local.get({ leads: [] });
  const el = document.getElementById("leads-list");
  const active = leads.filter((l) => !["Closed","DQ"].includes(l.stage));
  active.sort((a, b) => (a.dueAt || Infinity) - (b.dueAt || Infinity));

  if (!active.length) {
    el.innerHTML = `<div class="empty-state">No leads yet.<br>Browse IG and tap ＋ Save.</div>`;
    return;
  }

  el.innerHTML = active.map((l) => {
    const overdue = l.dueAt && l.dueAt < Date.now();
    return `
    <div class="lead-row ${overdue ? "overdue" : ""}">
      <div class="lead-main">
        <a href="https://www.instagram.com/${l.igUsername}/" target="_blank" class="lead-name">@${l.igUsername}</a>
        <span class="lead-stage">${l.stage}</span>
      </div>
      ${l.dueAt ? `<div class="lead-due ${overdue ? "red" : ""}">${dueLabel(l.dueAt)}</div>` : ""}
      <div class="stage-pills">
        ${STAGES.map((s) => `<button class="stage-pill ${s === l.stage ? "active" : ""}" data-id="${l.id}" data-stage="${s}">${s}</button>`).join("")}
      </div>
    </div>`;
  }).join("");

  el.querySelectorAll(".stage-pill").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { leads: all = [] } = await chrome.storage.local.get({ leads: [] });
      const idx = all.findIndex((l) => l.id === btn.dataset.id);
      if (idx >= 0) { all[idx].stage = btn.dataset.stage; all[idx].updatedAt = Date.now(); }
      await chrome.storage.local.set({ leads: all });
      loadLeads();
    });
  });
}

// ─── Quick Actions ────────────────────────────────────────────────────────────
async function loadActions() {
  const { vms = [], quickLinks = [] } = await chrome.storage.sync.get({ vms: [], quickLinks: [] });
  const vmEl = document.getElementById("vm-list");
  const linkEl = document.getElementById("links-list");
  const emptyEl = document.getElementById("actions-empty");

  if (!vms.length && !quickLinks.length) {
    vmEl.innerHTML = "";
    linkEl.innerHTML = "";
    emptyEl.classList.remove("hidden");
    return;
  }
  emptyEl.classList.add("hidden");

  vmEl.innerHTML = vms.map((vm, i) => `
    <div class="action-row">
      <span class="action-label">🎙 ${vm.label || `VM ${i + 1}`}</span>
      <div class="action-btns">
        <button class="btn-ghost btn-xs copy-action" data-url="${vm.url}">Copy</button>
        <button class="btn-pink btn-xs forward-vm" data-url="${vm.url}">Send →</button>
      </div>
    </div>`).join("");

  linkEl.innerHTML = quickLinks.map((lnk) => `
    <div class="action-row">
      <span class="action-label">🔗 ${lnk.label || lnk.url}</span>
      <div class="action-btns">
        <button class="btn-ghost btn-xs copy-action" data-url="${lnk.url}">Copy</button>
        <a href="${lnk.url}" target="_blank" class="btn-ghost btn-xs">Open →</a>
      </div>
    </div>`).join("");

  document.querySelectorAll(".copy-action").forEach((btn) => {
    btn.addEventListener("click", () => copyText(btn.dataset.url, btn));
  });

  document.querySelectorAll(".forward-vm").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
      const toUsername = tab?.url ? usernameFromUrl(tab.url) : "";
      chrome.runtime.sendMessage({ type: "FORWARD_VM", vmUrl: btn.dataset.url, toUsername });
      const orig = btn.textContent;
      btn.textContent = "Opening…";
      setTimeout(() => { btn.textContent = orig; }, 2000);
    });
  });
}

// ─── Scripts ──────────────────────────────────────────────────────────────────
const CATEGORY_LABELS = {
  openers: "Openers", followup: "Follow-Ups",
  qualification: "Qualify", objection: "Objections", pitch: "Pitch",
};

function renderScripts(category) {
  const pool = category === "all"
    ? Object.values(SCRIPTS).flat()
    : (SCRIPTS[category] || []);

  document.getElementById("scripts-list").innerHTML = pool.map((s) => `
    <div class="script-card">
      <div class="script-label">${s.label}</div>
      <div class="script-text">${s.text}</div>
      <button class="btn-ghost btn-xs copy-script" data-text="${encodeURIComponent(s.text)}">Copy</button>
    </div>`).join("") || `<div class="empty-state">No scripts here.</div>`;

  document.querySelectorAll(".copy-script").forEach((btn) => {
    btn.addEventListener("click", () => copyText(decodeURIComponent(btn.dataset.text), btn));
  });
}

function initScripts() {
  const filter = document.getElementById("scripts-filter");
  const cats = [["all","All"], ...Object.entries(CATEGORY_LABELS)];
  filter.innerHTML = cats.map(([k, v]) =>
    `<button class="script-tab ${k === "all" ? "active" : ""}" data-cat="${k}">${v}</button>`
  ).join("");
  filter.querySelectorAll(".script-tab").forEach((btn) => {
    btn.addEventListener("click", () => {
      filter.querySelectorAll(".script-tab").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      renderScripts(btn.dataset.cat);
    });
  });
  renderScripts("all");
}

// ─── Settings ─────────────────────────────────────────────────────────────────
let settingVms = [];
let settingLinks = [];

function makeRow(type, item, idx) {
  return `<div class="setting-row">
    <input class="field-input" style="flex:1;min-width:0" placeholder="Label" value="${item?.label || ""}" data-field="label" data-type="${type}" data-idx="${idx}">
    <input class="field-input" style="flex:2;min-width:0" placeholder="${type === 'vm' ? 'IG DM link' : 'https://'}" value="${item?.url || ""}" data-field="url" data-type="${type}" data-idx="${idx}">
    <button class="btn-ghost btn-xs remove-row" data-type="${type}" data-idx="${idx}">✕</button>
  </div>`;
}

function renderSettingRows() {
  document.getElementById("vm-settings").innerHTML = settingVms.map((v, i) => makeRow("vm", v, i)).join("");
  document.getElementById("link-settings").innerHTML = settingLinks.map((l, i) => makeRow("link", l, i)).join("");
  document.querySelectorAll(".remove-row").forEach((btn) => {
    btn.addEventListener("click", () => {
      if (btn.dataset.type === "vm") settingVms.splice(+btn.dataset.idx, 1);
      else settingLinks.splice(+btn.dataset.idx, 1);
      renderSettingRows();
    });
  });
  document.querySelectorAll("[data-field]").forEach((inp) => {
    inp.addEventListener("input", () => {
      const arr = inp.dataset.type === "vm" ? settingVms : settingLinks;
      if (!arr[+inp.dataset.idx]) arr[+inp.dataset.idx] = {};
      arr[+inp.dataset.idx][inp.dataset.field] = inp.value;
    });
  });
}

document.getElementById("settings-btn").addEventListener("click", async () => {
  const d = await chrome.storage.sync.get({ dashboardUrl:"http://localhost:3000", igSecret:"", vms:[], quickLinks:[] });
  document.getElementById("input-url").value = d.dashboardUrl;
  document.getElementById("input-secret").value = d.igSecret;
  settingVms = [...d.vms];
  settingLinks = [...d.quickLinks];
  renderSettingRows();
  document.getElementById("settings-overlay").classList.remove("hidden");
});

document.getElementById("settings-close-btn").addEventListener("click", () => {
  document.getElementById("settings-overlay").classList.add("hidden");
});

document.getElementById("add-vm-btn").addEventListener("click", () => {
  settingVms.push({ label:"", url:"" });
  renderSettingRows();
});

document.getElementById("add-link-btn").addEventListener("click", () => {
  settingLinks.push({ label:"", url:"" });
  renderSettingRows();
});

document.getElementById("settings-save-btn").addEventListener("click", async () => {
  await chrome.storage.sync.set({
    dashboardUrl: document.getElementById("input-url").value.trim() || "http://localhost:3000",
    igSecret: document.getElementById("input-secret").value.trim(),
    vms: settingVms.filter((v) => v.url),
    quickLinks: settingLinks.filter((l) => l.url),
  });
  document.getElementById("settings-overlay").classList.add("hidden");
  loadActions();
});

// ─── Dashboard link ───────────────────────────────────────────────────────────
document.getElementById("open-dashboard-btn").addEventListener("click", async () => {
  const { dashboardUrl } = await chrome.storage.sync.get({ dashboardUrl:"http://localhost:3000" });
  chrome.tabs.create({ url: dashboardUrl });
});

// ─── Quick save bar ───────────────────────────────────────────────────────────
const IG_RESERVED = new Set(["explore","reels","reel","stories","direct","accounts","p","tv","live"]);

function usernameFromUrl(url) {
  try {
    const seg = new URL(url).pathname.split("/").filter(Boolean);
    if (seg.length !== 1 || IG_RESERVED.has(seg[0])) return "";
    if (!/^[a-zA-Z0-9._]+$/.test(seg[0])) return "";
    return seg[0];
  } catch { return ""; }
}

async function updateSaveBar() {
  const [tab] = await chrome.tabs.query({ active:true, currentWindow:true });
  const bar = document.getElementById("quick-save-bar");
  if (!tab?.url?.includes("instagram.com")) { bar.classList.add("hidden"); return; }
  const username = usernameFromUrl(tab.url);
  if (!username) { bar.classList.add("hidden"); return; }
  document.getElementById("current-user").textContent = `@${username}`;
  bar.classList.remove("hidden");
  document.getElementById("quick-save-btn").onclick = () => {
    chrome.tabs.sendMessage(tab.id, { type:"TRIGGER_SAVE" });
  };
}

chrome.tabs.onActivated.addListener(updateSaveBar);
chrome.tabs.onUpdated.addListener((_, i) => { if (i.status === "complete") updateSaveBar(); });
updateSaveBar();

// ─── Live updates ─────────────────────────────────────────────────────────────
chrome.storage.onChanged.addListener(() => { loadLeads(); loadActions(); });

// ─── Init ─────────────────────────────────────────────────────────────────────
loadLeads();
loadActions();
initScripts();
