const STAGES = ["New", "Warming", "DM Sent", "Qualifying", "Call Offered", "Booked", "Closed", "DQ"];

const FU_PLAN = {
  "ig-warm": [
    { prefix: "IG · DM Opener", delayH: 48 },
    { prefix: "IG · FU1 Story", delayH: 72 },
    { prefix: "IG · FU2 Value", delayH: 120 },
    { prefix: "IG · FU3 Breakup", delayH: 168 },
  ],
  "call-offered": [
    { prefix: "Call-Offered · FU1", delayH: 24 },
    { prefix: "Call-Offered · FU2", delayH: 48 },
    { prefix: "Call-Offered · FU3", delayH: 72 },
  ],
};

let allLeads = [];
let activeFilter = "all";

function urgencyBucket(lead) {
  if (["Closed", "DQ"].includes(lead.stage)) return "archived";
  if (lead.stage === "Booked") return "booked";
  if (!lead.dueAt) return "upcoming";
  const now = Date.now();
  const eod = new Date(); eod.setHours(23, 59, 59, 999);
  if (lead.dueAt < now) return "overdue";
  if (lead.dueAt <= eod.getTime()) return "today";
  return "upcoming";
}

function relTime(ts) {
  const diff = Date.now() - ts;
  const h = Math.floor(diff / 3600000);
  return h < 24 ? `${h}h ago` : `${Math.floor(h / 24)}d ago`;
}

function dueLabel(ts) {
  const diff = ts - Date.now();
  if (diff < 0) {
    const h = Math.floor(-diff / 3600000);
    return h < 24 ? `${h}h overdue` : `${Math.floor(h / 24)}d overdue`;
  }
  const h = Math.floor(diff / 3600000);
  return h < 24 ? `due in ${h}h` : `due in ${Math.floor(h / 24)}d`;
}

function renderLeads() {
  const list = document.getElementById("leadList");
  const visible = allLeads.filter((l) => {
    if (activeFilter === "all") return !["Closed", "DQ"].includes(l.stage);
    return urgencyBucket(l) === activeFilter;
  });

  if (!visible.length) {
    list.innerHTML = `<p class="empty">No leads here yet.</p>`;
    return;
  }

  list.innerHTML = visible.map((lead) => {
    const b = urgencyBucket(lead);
    const lastEv = lead.igEvents?.at(-1);
    return `
      <div class="lead-card urgency-${b}" data-id="${lead.id}">
        <div class="lead-row">
          <span class="lead-name">${lead.igUsername ? "@" + lead.igUsername : lead.name}</span>
          <span class="lead-stage">${lead.stage}</span>
        </div>
        <div class="lead-meta">
          ${lastEv ? `<span>${lastEv.type} · ${relTime(lastEv.ts)}</span>` : ""}
          ${lead.dueAt ? `<span class="${b === "overdue" ? "overdue-text" : ""}">${dueLabel(lead.dueAt)}</span>` : ""}
        </div>
        <div class="stage-pills">
          ${STAGES.map((s) => `<button class="pill ${lead.stage === s ? "active" : ""}" data-id="${lead.id}" data-stage="${s}">${s}</button>`).join("")}
        </div>
      </div>
    `;
  }).join("");

  list.querySelectorAll(".pill").forEach((btn) => {
    btn.addEventListener("click", async (e) => {
      e.stopPropagation();
      const { id, stage } = btn.dataset;
      await chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id, updates: { stage } });
      loadLeads();
    });
  });
}

async function loadLeads() {
  const { leads } = await chrome.runtime.sendMessage({ type: "GET_LEADS" });
  allLeads = leads.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
  renderLeads();
}

// Filters
document.querySelectorAll(".filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.filter;
    renderLeads();
  });
});

// Track button
document.getElementById("trackBtn").addEventListener("click", async () => {
  const name = document.getElementById("trackName").value.trim();
  const source = document.getElementById("trackSource").value;
  if (!name) return;
  const igUsername = name.startsWith("@") ? name.slice(1) : name;
  await chrome.runtime.sendMessage({
    type: "IG_FOLLOW",
    username: igUsername,
    userId: null,
    pageUrl: null,
  });
  document.getElementById("trackName").value = "";
  loadLeads();
});

// Open full dashboard
document.getElementById("openDashboard").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

// Script vault
const catSelect = document.getElementById("scriptCategory");
const scriptList = document.getElementById("scriptList");

Object.keys(SCRIPTS).forEach((cat) => {
  const opt = document.createElement("option");
  opt.value = cat;
  opt.textContent = cat;
  catSelect.appendChild(opt);
});

function renderScripts() {
  const cat = catSelect.value;
  scriptList.innerHTML = (SCRIPTS[cat] || []).map((s) => `
    <div class="script-item">
      <p class="script-label">${s.label}</p>
      <p class="script-text">${s.text}</p>
      <button class="copy-btn" data-text="${encodeURIComponent(s.text)}">Copy</button>
    </div>
  `).join("");

  scriptList.querySelectorAll(".copy-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      navigator.clipboard.writeText(decodeURIComponent(btn.dataset.text));
      btn.textContent = "Copied!";
      setTimeout(() => (btn.textContent = "Copy"), 1500);
    });
  });
}

catSelect.addEventListener("change", renderScripts);
renderScripts();

// Storage listener for realtime updates
chrome.storage.onChanged.addListener(() => loadLeads());

loadLeads();
