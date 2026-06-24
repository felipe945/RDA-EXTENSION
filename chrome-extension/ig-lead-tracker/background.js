// Service worker — handles IG events, lead CRUD, alarms, notifications

const DASHBOARD_URL = "http://localhost:3000"; // change to prod URL after deploy
const IG_EVENTS_SECRET = ""; // paste your IG_EVENTS_SECRET here

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

const STAGES = ["New", "Warming", "DM Sent", "Qualifying", "Call Offered", "Booked", "Closed", "DQ"];

// ── Helpers ────────────────────────────────────────────────────────────────────

async function getLeads() {
  const { leads } = await chrome.storage.local.get({ leads: {} });
  return leads;
}

async function saveLead(lead) {
  const leads = await getLeads();
  leads[lead.id] = lead;
  await chrome.storage.local.set({ leads });

  // Also POST to Next.js backend if secret is set
  if (IG_EVENTS_SECRET && lead.igEvents?.length) {
    const ev = lead.igEvents.at(-1);
    fetch(`${DASHBOARD_URL}/api/ig-events`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-ig-secret": IG_EVENTS_SECRET },
      body: JSON.stringify({ type: ev.type, username: lead.igUsername, pageUrl: ev.postUrl }),
    }).catch(() => {});
  }
}

function makeId() {
  return `lead_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

function nextDue(plan, stepIndex) {
  const step = plan[stepIndex];
  if (!step) return null;
  return Date.now() + step.delayH * 3600000;
}

// ── Message handlers ───────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const leads = await getLeads();

    if (msg.type === "IG_FOLLOW" || msg.type === "IG_LIKE") {
      const { username, userId, pageUrl } = msg;
      const existing = Object.values(leads).find((l) => l.igUsername === username);
      const event = { type: msg.type === "IG_FOLLOW" ? "follow" : "like", postUrl: pageUrl, ts: Date.now() };

      if (existing) {
        existing.igEvents = [...(existing.igEvents || []), event];
        existing.updatedAt = Date.now();
        await saveLead(existing);
      } else {
        const lead = {
          id: makeId(),
          name: username,
          igUsername: username,
          userId,
          stage: msg.type === "IG_FOLLOW" ? "Warming" : "New",
          source: "IG",
          fuPlan: "ig-warm",
          fuStep: 0,
          dueAt: nextDue(FU_PLAN["ig-warm"], 0),
          igEvents: [event],
          notes: "",
          createdAt: Date.now(),
          updatedAt: Date.now(),
        };
        await saveLead(lead);
        scheduleAlarm(lead);
      }
      sendResponse({ ok: true });
    }

    if (msg.type === "UPDATE_LEAD") {
      const lead = { ...leads[msg.id], ...msg.updates, updatedAt: Date.now() };
      await saveLead(lead);
      scheduleAlarm(lead);
      sendResponse({ ok: true });
    }

    if (msg.type === "GET_LEADS") {
      sendResponse({ leads: Object.values(leads) });
    }
  })();
  return true; // async response
});

// ── Alarms ─────────────────────────────────────────────────────────────────────

function scheduleAlarm(lead) {
  if (!lead.dueAt || ["Closed", "DQ", "Booked"].includes(lead.stage)) return;
  chrome.alarms.create(`due_${lead.id}`, { when: lead.dueAt });
}

chrome.alarms.onAlarm.addListener(async (alarm) => {
  if (!alarm.name.startsWith("due_")) return;
  const leadId = alarm.name.replace("due_", "");
  const leads = await getLeads();
  const lead = leads[leadId];
  if (!lead || ["Closed", "DQ"].includes(lead.stage)) return;

  const plan = FU_PLAN[lead.fuPlan] || FU_PLAN["ig-warm"];
  const step = plan[lead.fuStep];
  if (!step) return;

  chrome.notifications.create(`notif_${lead.id}`, {
    type: "basic",
    iconUrl: "icons/icon48.png",
    title: `Follow-up due: @${lead.igUsername}`,
    message: step.prefix,
  });
});

chrome.notifications.onClicked.addListener((notifId) => {
  if (!notifId.startsWith("notif_")) return;
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});
