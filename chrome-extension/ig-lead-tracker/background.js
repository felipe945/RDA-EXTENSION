// FanBasis background service worker
// - Fetches leads + notifications from dashboard API every 3 min
// - Detects cross-platform replies (LinkedIn/Twitter) from content scripts
// - Sets badge count for urgent items
// - Relays messages between content scripts and API

const DEFAULT_URL = "https://fanmas.vercel.app";

// ── URL healing ───────────────────────────────────────────────────────────────
// unified-sales-ops.vercel.app now 307-redirects to fanmas, and fetch strips the
// Authorization header across a cross-origin redirect → the leads fetch lands
// unauthenticated (401) and the cache silently stayed empty. Any stored dashboardUrl
// that isn't the canonical prod host (or localhost for dev) gets healed to
// DEFAULT_URL. This also future-proofs the next rename: an unknown host can't
// re-trigger the token-stripping redirect.
const DEAD_HOSTS = ["unified-sales-ops.vercel.app"];
function healUrl(u) {
  try {
    const host = new URL(u).hostname;
    if (host === "localhost") return u;                 // local dev
    if (host === new URL(DEFAULT_URL).hostname) return u; // canonical prod
    return DEFAULT_URL;                                  // dead/unknown host → heal
  } catch { return DEFAULT_URL; }
}

// One-time migration: rewrite any stale dashboardUrl persisted in storage so the
// content scripts / sidepanel / popup that read it directly also see the fix.
async function healStoredUrls() {
  try {
    const [sync, local] = await Promise.all([
      chrome.storage.sync.get({ dashboardUrl: null }),
      chrome.storage.local.get({ fb_bootstrap: null }),
    ]);
    if (sync.dashboardUrl && healUrl(sync.dashboardUrl) !== sync.dashboardUrl) {
      await chrome.storage.sync.set({ dashboardUrl: healUrl(sync.dashboardUrl) });
    }
    const boot = local.fb_bootstrap;
    if (boot?.dashboardUrl && healUrl(boot.dashboardUrl) !== boot.dashboardUrl) {
      boot.dashboardUrl = healUrl(boot.dashboardUrl);
      await chrome.storage.local.set({ fb_bootstrap: boot });
    }
  } catch (err) {
    console.warn("[FanBasis] healStoredUrls failed:", err);
  }
}

// ── Rep auth (CONNECT contracts C1/C2) ────────────────────────────────────────
// The extension never runs its own Google OAuth. Sign-in goes through the
// dashboard: launchWebAuthFlow → /api/extension/auth/start → `#token=<repToken>`
// (a 90-day JWT minted by the dashboard). 401 anywhere = signed out.

async function getRepToken() {
  const { fb_rep_token } = await chrome.storage.local.get({ fb_rep_token: null });
  return fb_rep_token;
}

async function authHeader() {
  const token = await getRepToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function signOut() {
  await chrome.storage.local.remove(["fb_rep_token", "fb_bootstrap"]);
}

// C2 — self-provision all config from the dashboard; cached in fb_bootstrap
async function fetchBootstrap() {
  const token = await getRepToken();
  if (!token) return null;
  const { dashboardUrl } = await getSettings();
  const res = await fetch(`${dashboardUrl}/api/extension/bootstrap`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (res.status === 401) { await signOut(); return null; }
  if (!res.ok) throw new Error(`bootstrap_${res.status}`);
  const data = await res.json();
  if (!data?.ok) throw new Error("bootstrap_bad_response");
  await chrome.storage.local.set({ fb_bootstrap: data });
  return data;
}

// C1 — one Google sign-in, brokered by the dashboard
async function signIn() {
  const { dashboardUrl } = await getSettings();
  const extRedirect = chrome.identity.getRedirectURL();
  const startUrl = `${dashboardUrl}/api/extension/auth/start?ext_redirect=${encodeURIComponent(extRedirect)}`;
  const responseUrl = await new Promise((resolve, reject) =>
    chrome.identity.launchWebAuthFlow({ url: startUrl, interactive: true }, (url) => {
      if (chrome.runtime.lastError || !url) reject(new Error(chrome.runtime.lastError?.message || "cancelled"));
      else resolve(url);
    })
  );
  const token = new URLSearchParams(new URL(responseUrl).hash.slice(1)).get("token");
  if (!token) throw new Error("no_token");
  await chrome.storage.local.set({ fb_rep_token: token });
  return fetchBootstrap();
}

let cache = { leads: [], notifications: [], overdue: [], lastFetch: 0, authError: false };
const seenNotifIds = new Set();

// ── Settings ──────────────────────────────────────────────────────────────────

// Bootstrap values win; legacy storage.sync fields (and the hardcoded prod URL)
// only cover the window before the first sign-in.
async function getSettings() {
  const [sync, local] = await Promise.all([
    chrome.storage.sync.get({ dashboardUrl: DEFAULT_URL, igSecret: "", fanbasisHandle: "fanbasis", personalIgUsername: "", calendarUrl: "" }),
    chrome.storage.local.get({ fb_bootstrap: null, fb_rep_token: null }),
  ]);
  const boot = local.fb_bootstrap;
  return {
    dashboardUrl: healUrl(boot?.dashboardUrl || sync.dashboardUrl || DEFAULT_URL),
    igSecret: sync.igSecret,
    repToken: local.fb_rep_token || "",
    signedIn: !!local.fb_rep_token,
    fanbasisHandle: boot?.fanbasisHandle || sync.fanbasisHandle,
    personalIgUsername: boot?.rep?.personalIgUsername || sync.personalIgUsername,
    calendarUrl: sync.calendarUrl,
    slotMins: boot?.calendar?.slotMins || 45,
    rep: boot?.rep || null,
    calendarConnected: !!boot?.calendar?.connected,
  };
}

// ── Cache refresh ─────────────────────────────────────────────────────────────

async function refreshCache() {
  const { dashboardUrl } = await getSettings();
  const bearer = await authHeader();
  try {
    const [leadsRes, notifsRes] = await Promise.allSettled([
      fetch(`${dashboardUrl}/api/leads?mode=sales`, { headers: bearer }),
      fetch(`${dashboardUrl}/api/notifications?mode=sales`, { headers: bearer }),
    ]);

    if (leadsRes.status === "fulfilled") {
      if (leadsRes.value.ok) {
        const { leads } = await leadsRes.value.json();
        cache.leads = leads ?? [];
        cache.authError = false;
      } else if (leadsRes.value.status === 401 || leadsRes.value.status === 403) {
        // Never eat a 401 as "no leads": keep fb_rep_token (may be transient) but
        // flag it so the sidepanel shows the sign-in gate instead of an empty queue.
        cache.authError = true;
      }
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
    const settings = await getSettings();
    const { dashboardUrl, igSecret } = settings;
    const bearer = settings.repToken ? { Authorization: `Bearer ${settings.repToken}` } : {};

    switch (msg.type) {

      case "GET_LEADS":
        sendResponse({ leads: cache.leads });
        break;

      case "GET_NOTIFICATIONS":
        sendResponse({ notifications: cache.notifications, overdue: cache.overdue });
        break;

      case "GET_SETTINGS":
        sendResponse({ ...settings, authError: !!cache.authError });
        break;

      case "SIGN_IN": {
        try {
          const bootstrap = await signIn();
          setTimeout(refreshCache, 500);
          sendResponse({ ok: true, bootstrap });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      case "SIGN_OUT": {
        await signOut();
        sendResponse({ ok: true });
        break;
      }

      case "REFRESH_BOOTSTRAP": {
        try {
          const bootstrap = await fetchBootstrap();
          sendResponse({ ok: !!bootstrap, bootstrap });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      case "FB_PROFILE_ACTIVE":
        sendResponse({ ok: true });
        break;

      case "REFRESH_CACHE":
        await refreshCache();
        sendResponse({ ok: true });
        break;

      case "IG_FOLLOW":
      case "IG_LIKE": {
        // C4: Bearer repToken is the identity; keep x-ig-secret during rollout
        if (igSecret || bearer.Authorization) {
          const { activeIgAccount: fromAcct = "" } = await chrome.storage.local.get({ activeIgAccount: "" });
          fetch(`${dashboardUrl}/api/ig-events`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...(igSecret ? { "x-ig-secret": igSecret } : {}), ...bearer },
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
            headers: { "Content-Type": "application/json", ...bearer },
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

      // Contract TOUCH: per-rep channel touch. The server stamps WHO from the
      // Bearer token — the client never sends rep identity and never composes
      // the whole outreach_channels object (no clobber of other reps' entries).
      case "TOUCH_LEAD": {
        try {
          const res = await fetch(`${dashboardUrl}/api/leads/touch`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...bearer },
            body: JSON.stringify({ leadId: msg.id, channel: msg.channel, sent: msg.sent !== false }),
          });
          if (!res.ok) throw new Error(String(res.status));
          const data = await res.json();
          // Optimistic cache update with the server-merged shape so chips
          // re-read fresh outreach_channels before the delayed refresh lands
          const target = cache.leads.find((l) => l.id === msg.id);
          if (target && data.outreach_channels) target.outreach_channels = data.outreach_channels;
          await chrome.storage.local.set({ fb_cache: cache });
          chrome.tabs.query({ url: "https://www.instagram.com/*" }, (tabs) => {
            for (const tab of (tabs || [])) {
              chrome.tabs.sendMessage(tab.id, { type: "LEAD_UPDATED", leadId: msg.id }).catch(() => {});
            }
          });
          setTimeout(refreshCache, 1500);
          sendResponse({ ok: true, outreach_channels: data.outreach_channels });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      // C4: server-side snooze — POST /api/leads/:id/snooze { until: ISO | null }
      case "SNOOZE_LEAD": {
        try {
          const res = await fetch(`${dashboardUrl}/api/leads/${msg.id}/snooze`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...bearer },
            body: JSON.stringify({ until: msg.until ?? null }),
          });
          if (!res.ok) throw new Error(String(res.status));
          // Optimistic cache update so queues drop the lead before the next refresh
          const target = cache.leads.find((l) => l.id === msg.id);
          if (target) target.snoozed_until = msg.until ?? null;
          await chrome.storage.local.set({ fb_cache: cache });
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
        // Contract B: every activeIgAccount write carries a freshness timestamp
        if (handle) await chrome.storage.local.set({ activeIgAccount: handle, activeIgAccountTs: Date.now() });
        sendResponse({ ok: true });
        break;
      }

      // Stage pill changes from sidepanel sync back to dashboard
      case "UPDATE_LEAD_STAGE": {
        const { leadId, stage } = msg;
        try {
          const res = await fetch(`${dashboardUrl}/api/leads`, {
            method: "PATCH",
            headers: { "Content-Type": "application/json", ...bearer },
            body: JSON.stringify({ id: leadId, stage, updated_at: new Date().toISOString() }),
          });
          if (!res.ok) throw new Error(String(res.status));
          chrome.tabs.query({ url: "https://www.instagram.com/*" }, (tabs) => {
            for (const tab of (tabs || [])) {
              chrome.tabs.sendMessage(tab.id, { type: "LEAD_UPDATED", leadId }).catch(() => {});
            }
          });
          setTimeout(refreshCache, 1500);
          sendResponse({ ok: true });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      // LinkedIn / Twitter content scripts fire this when they detect a reply
      case "CROSS_PLATFORM_REPLY": {
        const { platform, detectedName, messagePreview, itemId, threadId } = msg;
        const nameLower = (detectedName ?? "").toLowerCase().trim().replace(/\s+/g, " ");

        // Guard: refuse to match if name is too short — would match almost anything
        if (!nameLower || nameLower.length < 3) {
          sendResponse({ ok: true, matched: false });
          break;
        }

        // Strict matches only: exact handle, exact LinkedIn /in/ slug, or
        // full-name equality. Substring/first-name matching flipped unrelated
        // leads to Replied, so anything ambiguous records nothing.
        const handleName = nameLower.replace(/^@/, "");
        const linkedinSlug = nameLower.replace(/ /g, "-");
        const candidates = cache.leads.filter((l) => {
          const lName = (l.name ?? "").toLowerCase().trim().replace(/\s+/g, " ");
          const lHandle = (l.ig_username ?? "").toLowerCase();
          const slugMatch = platform === "linkedin" &&
            ((l.linkedin_url ?? "").toLowerCase().match(/\/in\/([^/?#]+)/) || [])[1] === linkedinSlug;
          return (lHandle && lHandle === handleName) || slugMatch || (lName && lName === nameLower);
        });
        const matched = candidates.length === 1 ? candidates[0] : null;

        if (matched) {
          const now = new Date().toISOString();

          // Record inbound message. item_id lets the server dedup the same reply
          // detected by multiple reps on the shared account (null → plain insert).
          fetch(`${dashboardUrl}/api/messages`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...bearer },
            body: JSON.stringify({
              lead_id: matched.id,
              channel: platform,
              direction: "inbound",
              body: messagePreview || null,
              created_at: now,
              item_id: itemId ?? null,
              thread_id: threadId ?? null,
            }),
          }).catch(() => {});

          // Advance stage to Replied if still in early stages
          const EARLY_STAGES = ["New", "Warming", "DM Sent"];
          if (EARLY_STAGES.includes(matched.stage)) {
            fetch(`${dashboardUrl}/api/leads`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", ...bearer },
              body: JSON.stringify({ id: matched.id, stage: "Replied" }),
            }).catch(() => {});
          }

          // Broadcast on EVERY matched inbound (not just the first stage-flip) so
          // follow-up replies from already-Replied leads still refresh open tabs.
          chrome.tabs.query({ url: "https://www.instagram.com/*" }, (tabs) => {
            for (const tab of (tabs || [])) {
              chrome.tabs.sendMessage(tab.id, { type: "LEAD_UPDATED", leadId: matched.id }).catch(() => {});
            }
          });

          const icon = { ig: "📸", linkedin: "💼", twitter: "🐦" }[platform] || "💬";
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
            headers: { "Content-Type": "application/json", ...bearer },
            body: JSON.stringify({ channel: channel || "ig_dm", result: "sent", note: `Sent via FanBasis extension (${channelLabel})` }),
          }).catch(() => {});
          // Advance stage to DM Sent if still in early stages — FanBasis sends
          // ONLY. A personal-IG send records a per-rep touch and nothing else:
          // no stage, no due_at (locked model: "personal-first stays queued").
          const matched = cache.leads.find(l => l.id === leadId);
          const effectiveStage = msg.currentStage || matched?.stage;
          if (channel === "ig_fanbasis" && effectiveStage && ["New", "Warming"].includes(effectiveStage)) {
            const due = new Date(Date.now() + 3 * 24 * 3600000).toISOString();
            fetch(`${dashboardUrl}/api/leads`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json", ...bearer },
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

      // C3 — calendar lives server-side now; both handlers keep their message
      // names so the booking UIs barely change.
      case "CREATE_CALENDAR_EVENT": {
        try {
          if (!bearer.Authorization) { sendResponse({ ok: false, error: "signed_out", needsSignIn: true }); break; }
          const { slotStart, slotEnd, leadName, guestEmail, aeId } = msg;
          const resp = await fetch(`${dashboardUrl}/api/calendar/book`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...bearer },
            body: JSON.stringify({ slotStart, slotEnd, leadName, guestEmail, aeId: aeId || undefined }),
          });
          if (resp.status === 401) { sendResponse({ ok: false, error: "signed_out", needsSignIn: true }); break; }
          const data = await resp.json().catch(() => null);
          if (data?.needsCalendar) { sendResponse({ ok: false, needsCalendar: true }); break; }
          // Pass server error codes (slot_taken, ae_calendar_unreadable)
          // through so the pickers can react specifically.
          if (!resp.ok || !data?.ok) { sendResponse({ ok: false, error: data?.error || `book_${resp.status}` }); break; }
          sendResponse({ ok: true, eventId: data.eventId, eventLink: data.htmlLink, meetLink: data.meetLink });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      case "GET_CALENDAR_SLOTS": {
        try {
          if (!bearer.Authorization) { sendResponse({ ok: false, error: "signed_out", needsSignIn: true }); break; }
          const slotMins = settings.slotMins || 45;
          const ae = msg.aeId ? `&aeId=${msg.aeId}` : "";
          const late = msg.late ? "&late=1" : "";
          const resp = await fetch(`${dashboardUrl}/api/calendar/slots?days=14&slotMins=${slotMins}${ae}${late}`, { headers: bearer });
          if (resp.status === 401) { sendResponse({ ok: false, error: "signed_out", needsSignIn: true }); break; }
          const data = await resp.json().catch(() => null);
          if (data?.needsCalendar) { sendResponse({ ok: false, needsCalendar: true }); break; }
          if (!resp.ok || !data?.ok) { sendResponse({ ok: false, error: data?.error || `slots_${resp.status}` }); break; }
          sendResponse({ ok: true, slots: data.slots || [], slotMins });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      // Compare the installed version against the build published on the
      // dashboard (public/extension/latest.json) so the sidepanel can nudge.
      case "CHECK_UPDATE": {
        try {
          const resp = await fetch(`${dashboardUrl}/extension/latest.json`, { cache: "no-store" });
          const data = await resp.json().catch(() => null);
          const current = chrome.runtime.getManifest().version;
          const latest = data?.version || current;
          const isNewer = (a, c) => {
            const pa = a.split(".").map(Number), pc = c.split(".").map(Number);
            for (let i = 0; i < Math.max(pa.length, pc.length); i++) {
              const d = (pa[i] || 0) - (pc[i] || 0);
              if (d) return d > 0;
            }
            return false;
          };
          sendResponse({ ok: true, current, latest, updateAvailable: isNewer(latest, current) });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      // AE list for the booking pickers — who discovery calls get booked with.
      case "GET_AES": {
        try {
          if (!bearer.Authorization) { sendResponse({ ok: false, error: "signed_out", needsSignIn: true }); break; }
          const resp = await fetch(`${dashboardUrl}/api/aes`, { headers: bearer });
          if (resp.status === 401) { sendResponse({ ok: false, error: "signed_out", needsSignIn: true }); break; }
          const data = await resp.json().catch(() => null);
          if (!resp.ok || !data?.ok) { sendResponse({ ok: false, error: `aes_${resp.status}` }); break; }
          sendResponse({ ok: true, aes: (data.aes || []).filter(a => a.active) });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      // D1 (T1 auth contract): /api/opener + /api/ai/research-lead require a
      // Bearer repToken and CORS-allowlist only the extension's own origin —
      // so both calls run here in the SW (Origin: chrome-extension://<id>).
      // UI surfaces (sidepanel, IG card) reach them via sendMessage.
      case "FETCH_OPENER": {
        try {
          if (!bearer.Authorization) { sendResponse({ ok: false, error: "signed_out", needsSignIn: true }); break; }
          const qs = new URLSearchParams(msg.params || {}).toString();
          const resp = await fetch(`${dashboardUrl}/api/opener?${qs}`, { headers: bearer });
          if (resp.status === 401) { sendResponse({ ok: false, error: "signed_out", needsSignIn: true }); break; }
          const data = await resp.json().catch(() => null);
          if (!resp.ok) { sendResponse({ ok: false, error: `opener_${resp.status}` }); break; }
          sendResponse({ ok: true, opener: data?.opener || null });
        } catch (err) {
          sendResponse({ ok: false, error: err.message });
        }
        break;
      }

      case "RESEARCH_LEAD": {
        try {
          if (!bearer.Authorization) { sendResponse({ ok: false, error: "signed_out", needsSignIn: true }); break; }
          const resp = await fetch(`${dashboardUrl}/api/ai/research-lead`, {
            method: "POST",
            headers: { "Content-Type": "application/json", ...bearer },
            body: JSON.stringify({ leadId: msg.leadId }),
          });
          if (resp.status === 401) { sendResponse({ ok: false, error: "signed_out", needsSignIn: true }); break; }
          if (!resp.ok) { sendResponse({ ok: false, error: `research_${resp.status}` }); break; }
          sendResponse({ ok: true });
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

chrome.runtime.onStartup.addListener(() => {
  healStoredUrls().finally(() => {
    refreshCache();
    fetchBootstrap().catch(() => {});
  });
});
chrome.runtime.onInstalled.addListener(() => {
  healStoredUrls().finally(() => {
    refreshCache();
    fetchBootstrap().catch(() => {});
  });
  // v2.2.0: the extension no longer runs its own Google OAuth — drop its tokens
  chrome.storage.local.remove(["cal_token", "cal_token_exp", "cal_calendars", "cal_user_name"]).catch(() => {});
  chrome.storage.sync.remove(["cal_selected", "cal_slot_mins"]).catch(() => {});
});

// Seed cache from local storage, then heal stale URLs and refresh live
chrome.storage.local.get({ fb_cache: null }, ({ fb_cache }) => {
  if (fb_cache) cache = fb_cache;
  healStoredUrls().finally(() => {
    refreshCache();
    fetchBootstrap().catch(() => {});
  });
});
