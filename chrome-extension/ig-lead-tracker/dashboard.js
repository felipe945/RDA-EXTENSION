const STAGES = ["New", "Warming", "DM Sent", "Qualifying", "Call Offered", "Booked", "Closed", "DQ"];
const BUCKET_ORDER = ["overdue", "today", "upcoming", "booked", "archived"];
const BUCKET_LABELS = {
  overdue: "Overdue",
  today: "Due Today",
  upcoming: "Upcoming",
  booked: "Booked",
  archived: "Archived / DQ",
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

function renderCard(lead) {
  const b = urgencyBucket(lead);
  const lastEv = lead.igEvents?.at(-1);
  return `
    <div class="card urgency-${b}" data-id="${lead.id}">
      <div class="card-top">
        <div class="card-left">
          <span class="card-name">${lead.igUsername ? "@" + lead.igUsername : lead.name}</span>
          ${lastEv ? `<span class="card-meta">${lastEv.type === "follow" ? "Followed" : "Liked"} ${relTime(lastEv.ts)}</span>` : ""}
          ${lead.notes ? `<span class="card-meta note">${lead.notes.split("\n").at(-1) ?? ""}</span>` : ""}
        </div>
        <div class="card-right">
          <span class="card-stage">${lead.stage}</span>
          ${lead.dueAt ? `<span class="card-due ${b === "overdue" ? "overdue" : ""}">${dueLabel(lead.dueAt)}</span>` : ""}
        </div>
      </div>
      <div class="card-actions">
        <div class="stage-pills">
          ${STAGES.map((s) => `<button class="pill ${lead.stage === s ? "active" : ""}" data-id="${lead.id}" data-stage="${s}">${s}</button>`).join("")}
        </div>
        <div class="action-btns">
          <button class="note-btn" data-id="${lead.id}">Add Note</button>
          <button class="archive-btn" data-id="${lead.id}">Archive</button>
        </div>
      </div>
    </div>
  `;
}

function render() {
  const buckets = document.getElementById("buckets");
  const grouped = {};
  for (const b of BUCKET_ORDER) grouped[b] = [];
  for (const lead of allLeads) grouped[urgencyBucket(lead)].push(lead);

  const visibleBuckets = activeFilter === "all"
    ? BUCKET_ORDER.filter((b) => grouped[b].length > 0)
    : [activeFilter];

  buckets.innerHTML = visibleBuckets.map((b) => `
    <section class="bucket">
      <h2 class="bucket-title">${BUCKET_LABELS[b]} (${grouped[b].length})</h2>
      <div class="bucket-cards">
        ${grouped[b].length ? grouped[b].map(renderCard).join("") : `<p class="empty">Nothing here.</p>`}
      </div>
    </section>
  `).join("");

  document.getElementById("totalCount").textContent = `${allLeads.length} leads`;

  // Stage pills
  document.querySelectorAll(".pill").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const { id, stage } = btn.dataset;
      await chrome.runtime.sendMessage({ type: "UPDATE_LEAD", id, updates: { stage } });
      loadLeads();
    });
  });

  // Note button
  document.querySelectorAll(".note-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      const note = prompt("Add note:");
      if (!note) return;
      const lead = allLeads.find((l) => l.id === btn.dataset.id);
      const existing = lead?.notes ?? "";
      const ts = new Date().toLocaleString();
      await chrome.runtime.sendMessage({
        type: "UPDATE_LEAD",
        id: btn.dataset.id,
        updates: { notes: `${existing}\n[${ts}] ${note}`.trim() },
      });
      loadLeads();
    });
  });

  // Archive button
  document.querySelectorAll(".archive-btn").forEach((btn) => {
    btn.addEventListener("click", async () => {
      await chrome.runtime.sendMessage({
        type: "UPDATE_LEAD",
        id: btn.dataset.id,
        updates: { stage: "DQ" },
      });
      loadLeads();
    });
  });
}

async function loadLeads() {
  const { leads } = await chrome.runtime.sendMessage({ type: "GET_LEADS" });
  allLeads = leads.sort((a, b) => (a.dueAt ?? Infinity) - (b.dueAt ?? Infinity));
  render();
}

document.querySelectorAll(".filter").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".filter").forEach((b) => b.classList.remove("active"));
    btn.classList.add("active");
    activeFilter = btn.dataset.filter;
    render();
  });
});

document.getElementById("addLead").addEventListener("click", async () => {
  const name = prompt("Instagram @username:");
  if (!name) return;
  const username = name.startsWith("@") ? name.slice(1) : name;
  await chrome.runtime.sendMessage({ type: "IG_FOLLOW", username, userId: null, pageUrl: null });
  loadLeads();
});

chrome.storage.onChanged.addListener(() => loadLeads());
loadLeads();
