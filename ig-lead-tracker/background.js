// background.js — Service worker for IG Lead Tracker
// Handles: IG_FOLLOW, IG_LIKE (auto-track), IG_PROFILE_SAVE (manual save + push to dashboard)

const FU_PLAN = [
  { label: "DM Opener",  delayH: 48 },
  { label: "Story React", delayH: 120 },
  { label: "Value Add",  delayH: 192 },
  { label: "Breakup",    delayH: 312 },
];

// ─── Storage helpers ──────────────────────────────────────────────────────────

async function getLeads() {
  const { leads } = await chrome.storage.local.get({ leads: [] });
  return leads;
}

async function saveLeads(leads) {
  await chrome.storage.local.set({ leads });
}

async function upsertLead(username, patch) {
  const leads = await getLeads();
  const idx = leads.findIndex((l) => l.igUsername === username);

  if (idx >= 0) {
    leads[idx] = { ...leads[idx], ...patch, updatedAt: Date.now() };
    await saveLeads(leads);
    return leads[idx];
  } else {
    const lead = {
      id: crypto.randomUUID(),
      name: patch.displayName || username,
      igUsername: username,
      igProfileUrl: patch.igProfileUrl ?? null,
      source: "IG",
      stage: patch.stage ?? "Warming",
      igEvents: patch.igEvents ?? [],
      dueAt: patch.dueAt ?? Date.now() + 48 * 60 * 60 * 1000,
      notes: "",
      bio: patch.bio ?? "",
      followerCount: patch.followerCount ?? 0,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    leads.push(lead);
    await saveLeads(leads);
    return lead;
  }
}

async function appendEvent(username, event) {
  const leads = await getLeads();
  const idx = leads.findIndex((l) => l.igUsername === username);
  if (idx >= 0) {
    const igEvents = Array.isArray(leads[idx].igEvents) ? leads[idx].igEvents : [];
    leads[idx].igEvents = [...igEvents, event];
    leads[idx].updatedAt = Date.now();
    await saveLeads(leads);
  }
}

// ─── Follow-up alarm management ──────────────────────────────────────────────

async function scheduleFollowUps(leadId, startTs) {
  for (const step of FU_PLAN) {
    const alarmName = `fu:${leadId}:${step.label.replace(/\s/g, "_")}`;
    const fireTime = startTs + step.delayH * 60 * 60 * 1000;
    await chrome.alarms.create(alarmName, { when: fireTime });
  }
}

// ─── Dashboard POST ───────────────────────────────────────────────────────────

async function postToDashboard(payload) {
  const { dashboardUrl, igSecret } = await chrome.storage.sync.get({
    dashboardUrl: "http://localhost:3000",
    igSecret: "",
  });

  const res = await fetch(`${dashboardUrl}/api/ig-events`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-ig-secret": igSecret,
    },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Dashboard POST failed: ${res.status} ${text}`);
  }
  return res.json();
}

// ─── Message handler ──────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  handleMessage(msg).then(sendResponse).catch((err) => {
    console.error("[bg] message error:", err);
    sendResponse({ ok: false, error: err.message });
  });
  return true; // keep port open for async response
});

async function handleMessage(msg) {
  const { type, username, userId, pageUrl, bio, followerCount, displayName } = msg;

  switch (type) {
    case "IG_FOLLOW": {
      const event = { type: "IG_FOLLOW", postUrl: pageUrl ?? null, ts: Date.now() };
      const lead = await upsertLead(username, {
        stage: "Warming",
        igEvents: [event],
        igProfileUrl: `https://www.instagram.com/${username}/`,
      });
      await scheduleFollowUps(lead.id, Date.now());
      break;
    }

    case "IG_LIKE": {
      const event = { type: "IG_LIKE", postUrl: pageUrl ?? null, ts: Date.now() };
      const leads = await getLeads();
      const exists = leads.find((l) => l.igUsername === username);
      if (exists) {
        await appendEvent(username, event);
      } else {
        const lead = await upsertLead(username, {
          stage: "New",
          igEvents: [event],
          igProfileUrl: `https://www.instagram.com/${username}/`,
        });
        await scheduleFollowUps(lead.id, Date.now());
      }
      break;
    }

    case "FORWARD_VM": {
      const { vmUrl, toUsername } = msg;
      await chrome.storage.local.set({
        pendingForward: { toUsername: toUsername || "", vmUrl, ts: Date.now() },
      });
      chrome.tabs.create({ url: vmUrl });
      return { ok: true };
    }

    case "IG_PROFILE_SAVE": {
      const event = { type: "IG_PROFILE_SAVE", postUrl: pageUrl ?? null, ts: Date.now() };
      const lead = await upsertLead(username, {
        stage: "Warming",
        igEvents: [event],
        igProfileUrl: pageUrl ?? `https://www.instagram.com/${username}/`,
        bio: bio ?? "",
        followerCount: followerCount ?? 0,
        displayName: displayName || username,
      });
      await scheduleFollowUps(lead.id, Date.now());

      // Push to dashboard (fire-and-forget with error logging)
      try {
        await postToDashboard({
          type: "IG_PROFILE_SAVE",
          username,
          userId: userId ?? "",
          pageUrl: pageUrl ?? null,
          bio: bio ?? "",
          followerCount: followerCount ?? 0,
          displayName: displayName || username,
        });
      } catch (err) {
        console.error("[bg] dashboard POST failed (continuing anyway):", err);
      }

      // Notify the user
      chrome.notifications.create(`save:${username}`, {
        type: "basic",
        iconUrl: "icon128.png",
        title: "Lead saved!",
        message: `@${username} added to your lead list.`,
      });

      return { ok: true, leadId: lead.id };
    }

    default:
      console.warn("[bg] unknown message type:", type);
  }

  return { ok: true };
}

// ─── Alarm handler (follow-up reminders) ─────────────────────────────────────

chrome.alarms.onAlarm.addListener(async (alarm) => {
  // Alarm name format: "fu:<leadId>:<Step_Label>"
  if (!alarm.name.startsWith("fu:")) return;

  const parts = alarm.name.split(":");
  const leadId = parts[1];
  const stepLabel = parts.slice(2).join(":").replace(/_/g, " ");

  const leads = await getLeads();
  const lead = leads.find((l) => l.id === leadId);
  if (!lead) return;

  chrome.notifications.create(alarm.name, {
    type: "basic",
    iconUrl: "icon128.png",
    title: `Follow-up: ${stepLabel}`,
    message: `Time to send "${stepLabel}" to @${lead.igUsername}`,
  });
});

// ─── Notification click → open sidepanel ─────────────────────────────────────

chrome.notifications.onClicked.addListener(() => {
  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (tabs[0]?.id != null) {
      chrome.sidePanel.open({ tabId: tabs[0].id });
    }
  });
});

// ─── Extension icon click → toggle sidepanel ─────────────────────────────────

chrome.action.onClicked.addListener((tab) => {
  if (tab.id != null) {
    chrome.sidePanel.open({ tabId: tab.id });
  }
});
