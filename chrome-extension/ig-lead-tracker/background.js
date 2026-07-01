// FanBasis background service worker
// - Fetches leads + notifications from dashboard API every 3 min
// - Detects cross-platform replies (LinkedIn/Twitter) from content scripts
// - Sets badge count for urgent items
// - Relays messages between content scripts and API

const DEFAULT_URL = "https://unified-sales-ops.vercel.app";

// ── Google Calendar helpers ───────────────────────────────────────────────────

function calFindOpenSlots(freeBusyData, slotMins, maxSlots) {
  slotMins = slotMins || 30;
  maxSlots = maxSlots || 5;
  const slotMs = slotMins * 60 * 1000;
  const now = Date.now();

  const allBusy = [];
  const cals = (freeBusyData && freeBusyData.calendars) || {};
  for (const key of Object.keys(cals)) {
    for (const b of (cals[key].busy || [])) {
      allBusy.push({ start: new Date(b.start).getTime(), end: new Date(b.end).getTime() });
    }
  }

  // Start at least 1 hour from now, rounded up to next 15-min mark
  let cursor = Math.ceil((now + 60 * 60 * 1000) / (15 * 60 * 1000)) * (15 * 60 * 1000);
  const endTs = now + 7 * 24 * 60 * 60 * 1000;
  const slots = [];

  while (cursor < endTs && slots.length < maxSlots) {
    const d = new Date(cursor);
    const day = d.getDay();
    const hour = d.getHours();
    const min = d.getMinutes();

    if (day === 0 || day === 6) {
      const skip = new Date(cursor);
      skip.setDate(skip.getDate() + (day === 0 ? 1 : 2));
      skip.setHours(9, 0, 0, 0);
      cursor = skip.getTime();
      continue;
    }
    if (hour < 9) {
      const skip = new Date(cursor);
      skip.setHours(9, 0, 0, 0);
      cursor = skip.getTime();
      continue;
    }
    const slotEndTs = cursor + slotMs;
    const slotEndD = new Date(slotEndTs);
    if (slotEndD.getHours() > 18 || (slotEndD.getHours() === 18 && slotEndD.getMinutes() > 0)) {
      const skip = new Date(cursor);
      skip.setDate(skip.getDate() + 1);
      skip.setHours(9, 0, 0, 0);
      cursor = skip.getTime();
      continue;
    }

    const isBusy = allBusy.some(b => cursor < b.end && slotEndTs > b.start);
    if (!isBusy) slots.push({ start: new Date(cursor).toISOString(), end: new Date(slotEndTs).toISOString() });
    cursor += 15 * 60 * 1000;
  }
  return slots;
}

function calFormatSlot(isoStart) {
  const d = new Date(isoStart);
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const h = d.getHours();
  const m = d.getMinutes();
  const h12 = h % 12 || 12;
  const ampm = h >= 12 ? "pm" : "am";
  const minStr = m === 0 ? "" : `:${String(m).padStart(2, "0")}`;
  return `${days[d.getDay()]} ${months[d.getMonth()]} ${d.getDate()} · ${h12}${minStr}${ampm}`;
}

function calFormatSlotsForDm(isoStarts) {
  if (!isoStarts.length) return "";
  const d = new Date(isoStarts[0]);
  const days = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];
  const months = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  function fmt(iso) {
    const dt = new Date(iso);
    const h = dt.getHours(); const m = dt.getMinutes();
    const h12 = h % 12 || 12; const ampm = h >= 12 ? "pm" : "am";
    const minStr = m === 0 ? "" : `:${String(m).padStart(2, "0")}`;
    return `${days[dt.getDay()]} at ${h12}${minStr}${ampm}`;
  }
  const texts = isoStarts.map(fmt);
  if (texts.length === 1) return texts[0];
  if (texts.length === 2) return `${texts[0]} or ${texts[1]}`;
  const last = texts.pop();
  return texts.join(", ") + ", or " + last;
}

let cache = { leads: [], notifications: [], overdue: [], lastFetch: 0 };
const seenNotifIds = new Set();

// ── Settings ──────────────────────────────────────────────────────────────────

async function getSettings() {
  return new Promise((resolve) =>
    chrome.storage.sync.get({ dashboardUrl: DEFAULT_URL, igSecret: "", fanbasisHandle: "fanbasis", personalIgUsername: "felipeguimars" }, resolve)
  );
}

// ── Cache refresh ─────────────────────────────────────────────────────────────

async function refreshCache() {
  const { dashboardUrl } = await getSettings();
  try {
    const [leadsRes, notifsRes] = await Promise.allSettled([
      fetch(`${dashboardUrl}/api/leads?mode=sales`),
      fetch(`${dashboardUrl}/api/notifications?mode=sales`),
    ]);

    if (leadsRes.status === "fulfilled" && leadsRes.value.ok) {
      const { leads } = await leadsRes.value.json();
      cache.leads = leads ?? [];
    }

    if (notifsRes.status === "fulfilled" && notifsRes.value.ok) {
      const { notifications, overdue } = await notifsRes.value.json();
      const fresh = (notifications ?? []).filter((n) => !seenNotifIds.has(n.id));

      // Fire Chrome notification for each new reply (max 3 at once)
      for (const n of fresh.slice(0, 3)) {
        const icon = { gmail: "✉", linkedin: "💼", twitter: "🐦", ig: "📸" }[n.channel] || "💬";
        chrome.notifications.create(`fb_${n.id}`, {
          type: "basic",
          iconUrl: "icons/icon48.png",
          title: `${icon} ${n.leadName} replied`,
          message: n.summary || "New message",
        });
      }
      fresh.forEach((n) => seenNotifIds.add(n.id));

      cache.notifications = notifications ?? [];
      cache.overdue = overdue ?? [];
      cache.lastFetch = Date.now();
    }

    // Badge = overdue FUs + unread notifications
    const badgeN = cache.overdue.length + cache.notifications.length;
    chrome.action.setBadgeText({ text: badgeN > 0 ? String(badgeN) : "" });
    chrome.action.setBadgeBackgroundColor({ color: "#FF3A69" });

    await chrome.storage.local.set({ fb_cache: cache });
  } catch (err) {
    console.warn("[FanBasis] cache refresh failed:", err);
  }
}

// ── Message router ────────────────────────────────────────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    const { dashboardUrl, igSecret } = await getSettings();

    switch (msg.type) {

      case "GET_LEADS":
        sendResponse({ leads: cache.leads });
        break;

      case "GET_NOTIFICATIONS":
        sendResponse({ notifications: cache.notifications, overdue: cache.overdue });
        break;

      case "GET_SETTINGS":
        sendResponse({ dashboardUrl, igSecret });
        break;

      case "FB_PROFILE_ACTIVE":
        sendResponse({ ok: true });
        break;

      case "REFRESH_CACHE":
        await refreshCache();
        sendResponse({ ok: true });
        break;

      case "IG_FOLLOW":
      case "IG_LIKE": {
        if (igSecret) {
          const { activeIgAccount: fromAcct = "" } = await chrome.storage.local.get({ activeIgAccount: "" });
          fetch(`${dashboardUrl}/api/ig-events`, {
            method: "POST",
            headers: { "Content-Type": "application/json", "x-ig-secret": igSecret },
            body: JSON.stringify({
              type: msg.type === "IG_FOLLOW" ? "follow" : "like",
              username: msg.username,
              userId: msg.userId,
              pageUrl: msg.pageUrl,
              savedFromAccount: fromAcct,
            }),
          })
            .then(() => setTimeout(refreshCache, 2000))
            .catch(() => {});
        }
        sendResponse({ ok: true });
        break;
      }

      case "UPDATE_LEAD": {
        try {
          const res = await fetch(`${dashboardUrl}/api/leads`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: msg.id, ...msg.updates }),
          });
          if (!res.ok) throw new Error(String(res.status));
          chrome.tabs.query({ url: "https://www.instagram.com/*" }, (tabs) => {
            for (const tab of (tabs || [])) {
              chrome.tabs.sendMessage(tab.id, { type: "LEAD_UPDATED", leadId: msg.id }).catch(() => {});
            }
          });
          setTimeout(refreshCache, 1500);
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      // Saves which IG account is currently logged in (detected by page-interceptor)
      case "IG_VIEWER": {
        const { handle } = msg;
        if (handle) await chrome.storage.local.set({ activeIgAccount: handle });
        sendResponse({ ok: true });
        break;
      }

      // Stage pill changes from sidepanel sync back to dashboard
      case "UPDATE_LEAD_STAGE": {
        const { leadId, stage } = msg;
        try {
          await fetch(`${dashboardUrl}/api/leads`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: leadId, stage, updated_at: new Date().toISOString() }),
          });
          chrome.tabs.query({ url: "https://www.instagram.com/*" }, (tabs) => {
            for (const tab of (tabs || [])) {
              chrome.tabs.sendMessage(tab.id, { type: "LEAD_UPDATED", leadId }).catch(() => {});
            }
          });
          setTimeout(refreshCache, 1500);
        } catch {}
        sendResponse({ ok: true });
        break;
      }

      // LinkedIn / Twitter content scripts fire this when they detect a reply
      case "CROSS_PLATFORM_REPLY": {
        const { platform, detectedName, messagePreview } = msg;
        const nameLower = (detectedName ?? "").toLowerCase().trim();

        // Guard: refuse to match if name is too short — would match almost anything
        if (!nameLower || nameLower.length < 3) {
          sendResponse({ ok: true, matched: false });
          break;
        }

        // Match by name against cached leads
        const matched = cache.leads.find((l) => {
          const lName = (l.name ?? "").toLowerCase();
          const lHandle = (l.ig_username ?? "").toLowerCase();
          const lLinkedin = (l.linkedin_url ?? "").toLowerCase();
          const firstName = lName.split(" ")[0];
          return (
            lName.includes(nameLower) ||
            (firstName.length >= 4 && nameLower.includes(firstName)) ||
            lHandle === nameLower.replace("@", "") ||
            (platform === "linkedin" && lLinkedin.includes(nameLower.replace(/ /g, "-")))
          );
        });

        if (matched) {
          const now = new Date().toISOString();

          // Record inbound message
          fetch(`${dashboardUrl}/api/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              lead_id: matched.id,
              channel: platform,
              direction: "inbound",
              body: messagePreview || null,
              created_at: now,
            }),
          }).catch(() => {});

          // Advance stage to Replied if still in early stages
          const EARLY_STAGES = ["New", "Warming", "DM Sent"];
          if (EARLY_STAGES.includes(matched.stage)) {
            fetch(`${dashboardUrl}/api/leads`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: matched.id, stage: "Replied" }),
            }).catch(() => {});
            chrome.tabs.query({ url: "https://www.instagram.com/*" }, (tabs) => {
              for (const tab of (tabs || [])) {
                chrome.tabs.sendMessage(tab.id, { type: "LEAD_UPDATED", leadId: matched.id }).catch(() => {});
              }
            });
          }

          const icon = { linkedin: "💼", twitter: "🐦" }[platform] || "💬";
          chrome.notifications.create(`reply_${matched.id}_${Date.now()}`, {
            type: "basic",
            iconUrl: "icons/icon48.png",
            title: `${icon} ${matched.name ?? matched.ig_username} replied on ${platform}!`,
            message: messagePreview?.slice(0, 100) || "New message",
          });

          setTimeout(refreshCache, 2500);
          sendResponse({ ok: true, matched: true, leadName: matched.name ?? matched.ig_username });
        } else {
          sendResponse({ ok: true, matched: false });
        }
        break;
      }

      case "FB_DM_SENT": {
        const { leadId, channel } = msg;
        if (leadId) {
          const channelLabel = { ig_fanbasis: "FanBasis IG", ig_personal: "Personal IG" }[channel] || channel || "IG";
          // Log touchpoint so dashboard's TouchpointsTab shows this DM
          fetch(`${dashboardUrl}/api/leads/${leadId}/touchpoints`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ channel: channel || "ig_dm", result: "sent", note: `Sent via FanBasis extension (${channelLabel})` }),
          }).catch(() => {});
          // Advance stage to DM Sent if still in early stages
          const matched = cache.leads.find(l => l.id === leadId);
          const effectiveStage = msg.currentStage || matched?.stage;
          if (effectiveStage && ["New", "Warming"].includes(effectiveStage)) {
            const due = new Date(Date.now() + 3 * 24 * 3600000).toISOString();
            fetch(`${dashboardUrl}/api/leads`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ id: leadId, stage: "DM Sent", last_contact_at: new Date().toISOString(), due_at: due }),
            }).catch(() => {});
          }
          // Push LEAD_UPDATED to open IG tabs so the mini card refreshes
          chrome.tabs.query({ url: "https://www.instagram.com/*" }, (tabs) => {
            for (const tab of (tabs || [])) {
              chrome.tabs.sendMessage(tab.id, { type: "LEAD_UPDATED", leadId }).catch(() => {});
            }
          });
          setTimeout(refreshCache, 1500);
        }
        sendResponse({ ok: true });
        break;
      }

      case "CONNECT_CALENDAR": {
        try {
          const token = await new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: true }, (t) => {
              if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
              else resolve(t);
            });
          });
          const resp = await fetch(
            "https://www.googleapis.com/calendar/v3/users/me/calendarList?minAccessRole=reader",
            { headers: { Authorization: `Bearer ${token}` } }
          );
          if (!resp.ok) throw new Error(`calendarList ${resp.status}`);
          const data = await resp.json();
          const calendars = (data.items || []).map(c => ({
            id: c.id,
            summary: c.summary || c.id,
            primary: !!c.primary,
            backgroundColor: c.backgroundColor || "#4285F4",
          }));
          const primaryCal = calendars.find(c => c.primary);
          const calUserName = primaryCal?.summary || "";
          await chrome.storage.local.set({ cal_token: token, cal_calendars: calendars, cal_user_name: calUserName });
          const existing = await new Promise(r => chrome.storage.sync.get({ cal_selected: [] }, r));
          if (!existing.cal_selected.length) {
            const primaryId = (calendars.find(c => c.primary) || calendars[0])?.id;
            if (primaryId) await chrome.storage.sync.set({ cal_selected: [primaryId] });
          }
          sendResponse({ ok: true, calendars });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      case "DISCONNECT_CALENDAR": {
        const { cal_token: t } = await chrome.storage.local.get({ cal_token: null });
        if (t) {
          chrome.identity.removeCachedAuthToken({ token: t }, () => {});
          await fetch(`https://accounts.google.com/o/oauth2/revoke?token=${t}`).catch(() => {});
        }
        await chrome.storage.local.remove(["cal_token", "cal_calendars"]);
        await chrome.storage.sync.remove(["cal_selected", "cal_slot_mins"]);
        sendResponse({ ok: true });
        break;
      }

      case "GET_CALENDAR_LIST": {
        const { cal_calendars: calendars = null } = await chrome.storage.local.get({ cal_calendars: null });
        sendResponse({ ok: !!calendars, calendars: calendars || [] });
        break;
      }

      case "SAVE_CALENDAR_SETTINGS": {
        const { selected, slotMins } = msg;
        await chrome.storage.sync.set({ cal_selected: selected || [], cal_slot_mins: slotMins || 30 });
        sendResponse({ ok: true });
        break;
      }

      case "CREATE_CALENDAR_EVENT": {
        try {
          const token = await new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: false }, (t) => {
              if (chrome.runtime.lastError || !t) reject(new Error("not_connected"));
              else resolve(t);
            });
          });
          const { slotStart, slotEnd, leadName, guestEmail } = msg;
          const { cal_user_name: userName = "FanBasis" } = await chrome.storage.local.get({ cal_user_name: "" });
          const displayLead = (leadName || "Lead").split(" ").slice(0, 2).join(" ");
          const displayUser = (userName || "FanBasis").split(" ")[0];
          const title = `FanBasis Discovery: ${displayLead} X ${displayUser}`;
          const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
          const body = {
            summary: title,
            start: { dateTime: slotStart, timeZone },
            end: { dateTime: slotEnd, timeZone },
            status: "tentative",
            description: "Booking sent via FanBasis Sales Extension",
            ...(guestEmail ? { attendees: [{ email: guestEmail }] } : {}),
          };
          const resp = await fetch("https://www.googleapis.com/calendar/v3/calendars/primary/events", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify(body),
          });
          if (!resp.ok) throw new Error(`create_event_${resp.status}`);
          const event = await resp.json();
          sendResponse({ ok: true, eventId: event.id, eventLink: event.htmlLink });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      case "GET_CALENDAR_SLOTS": {
        try {
          const token = await new Promise((resolve, reject) => {
            chrome.identity.getAuthToken({ interactive: false }, (t) => {
              if (chrome.runtime.lastError || !t) reject(new Error("not_connected"));
              else resolve(t);
            });
          });
          const { cal_selected: selected = [], cal_slot_mins: slotMins = 30 } =
            await new Promise(r => chrome.storage.sync.get({ cal_selected: [], cal_slot_mins: 30 }, r));
          if (!selected.length) { sendResponse({ ok: false, error: "no_calendars" }); break; }
          const timeMin = new Date().toISOString();
          const timeMax = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
          const fbResp = await fetch("https://www.googleapis.com/calendar/v3/freeBusy", {
            method: "POST",
            headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
            body: JSON.stringify({ timeMin, timeMax, items: selected.map(id => ({ id })) }),
          });
          if (!fbResp.ok) {
            if (fbResp.status === 401) {
              await chrome.storage.local.remove(["cal_token"]);
              sendResponse({ ok: false, error: "token_expired" });
            } else {
              sendResponse({ ok: false, error: `freebusy_${fbResp.status}` });
            }
            break;
          }
          const fbData = await fbResp.json();
          const slots = calFindOpenSlots(fbData, slotMins, 5);
          sendResponse({ ok: true, slots, slotMins });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      default:
        sendResponse({ ok: false });
    }
  })();
  return true;
});

// ── Alarms ────────────────────────────────────────────────────────────────────

chrome.alarms.create("fb_refresh", { periodInMinutes: 3 });
chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === "fb_refresh") refreshCache();
});

// ── Notification click → open dashboard ──────────────────────────────────────

chrome.notifications.onClicked.addListener(async () => {
  const { dashboardUrl } = await getSettings();
  chrome.tabs.create({ url: dashboardUrl });
});

// ── Startup ───────────────────────────────────────────────────────────────────

chrome.runtime.onStartup.addListener(refreshCache);
chrome.runtime.onInstalled.addListener(refreshCache);

// Seed cache from local storage, then refresh live
chrome.storage.local.get({ fb_cache: null }, ({ fb_cache }) => {
  if (fb_cache) cache = fb_cache;
  refreshCache();
});
