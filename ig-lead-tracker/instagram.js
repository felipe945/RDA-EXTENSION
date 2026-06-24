// instagram.js — Content script on instagram.com

// ─── Inject page-interceptor into page world ──────────────────────────────────
(function () {
  const s = document.createElement("script");
  s.src = chrome.runtime.getURL("page-interceptor.js");
  s.onload = () => s.remove();
  document.documentElement.prepend(s);
})();

// ─── URL tracking ─────────────────────────────────────────────────────────────
let urlUsername = "";

const IG_RESERVED = new Set([
  "explore", "reels", "reel", "stories", "direct", "accounts",
  "p", "tv", "live", "ar", "music", "graphql", "web",
]);

function extractUsername(pathname) {
  const seg = pathname.split("/").filter(Boolean);
  if (seg.length !== 1) return "";
  if (IG_RESERVED.has(seg[0])) return "";
  if (!/^[a-zA-Z0-9._]+$/.test(seg[0])) return "";
  return seg[0];
}

function isProfilePage() {
  return extractUsername(location.pathname) !== "";
}

// ─── Forward intercepted fetch events to background ──────────────────────────
window.addEventListener("ig-action", (e) => {
  const { type, userId } = e.detail;
  const username = urlUsername || extractUsername(location.pathname);
  if (!username) return;
  chrome.runtime.sendMessage({ type, username, userId: userId || "", pageUrl: location.href });
});

// ─── Save button injection ────────────────────────────────────────────────────
const BTN_ID = "ig-save-btn";
let lastHref = "";
let injectTimer = null;

function parseFollowers(text) {
  const m = text.match(/([\d,.]+)\s*([KkMm]?)\s*[Ff]ollowers/);
  if (!m) return 0;
  let n = parseFloat(m[1].replace(/,/g, ""));
  const s = m[2].toUpperCase();
  if (s === "K") n *= 1e3;
  if (s === "M") n *= 1e6;
  return Math.round(n);
}

function injectButton() {
  if (document.getElementById(BTN_ID)) return;
  if (!isProfilePage()) return;

  const username = extractUsername(location.pathname);
  if (!username) return;
  urlUsername = username;

  // Find anchor — the Follow / Message / Unfollow button row
  // Try multiple selectors in order of reliability
  const anchor =
    document.querySelector("header section") ||
    document.querySelector("main header") ||
    // Fallback: find any button with "Follow" text near the top
    [...document.querySelectorAll("button")].find(
      (b) => /^(Follow|Unfollow|Following|Message)$/.test(b.textContent.trim())
    )?.closest("div[class]") ||
    document.querySelector("header");

  if (!anchor) return;
  if (anchor.dataset.igSaveInjected) return;
  anchor.dataset.igSaveInjected = "1";

  const btn = document.createElement("button");
  btn.id = BTN_ID;
  btn.textContent = "＋ Save";
  btn.style.cssText = [
    "background:#ff0076",
    "color:#fff",
    "border:none",
    "border-radius:6px",
    "padding:6px 12px",
    "font-size:12px",
    "font-weight:600",
    "cursor:pointer",
    "margin:4px 0 0 8px",
    "line-height:1.4",
    "white-space:nowrap",
    "z-index:9999",
    "position:relative",
    "font-family:system-ui,sans-serif",
  ].join(";");

  btn.addEventListener("click", (e) => {
    e.stopPropagation();
    const bio = document.querySelector('meta[name="description"]')?.getAttribute("content") || "";
    const followerCount = parseFollowers(document.body.innerText || "");
    const displayName = document.querySelector("h2")?.textContent.trim() || username;

    btn.textContent = "Saving…";
    btn.disabled = true;
    btn.style.opacity = "0.7";

    chrome.runtime.sendMessage(
      { type: "IG_PROFILE_SAVE", username, userId: "", pageUrl: location.href, bio, followerCount, displayName },
      (resp) => {
        if (resp?.ok) {
          btn.textContent = "✓ Saved";
          btn.style.background = "#3d8b5c";
        } else {
          btn.textContent = "✗ Retry";
          btn.disabled = false;
          btn.style.opacity = "1";
          btn.style.background = "#cc0000";
        }
      }
    );
  });

  anchor.appendChild(btn);
}

function checkPage() {
  if (location.href === lastHref) return;
  lastHref = location.href;
  urlUsername = extractUsername(location.pathname);

  const old = document.getElementById(BTN_ID);
  if (old) old.remove();
  document.querySelectorAll("[data-ig-save-injected]").forEach(
    (el) => delete el.dataset.igSaveInjected
  );

  if (injectTimer) clearTimeout(injectTimer);
  if (isProfilePage()) {
    injectTimer = setTimeout(injectButton, 800);
  }
}

// ─── DM forward automation ────────────────────────────────────────────────────

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function reactSet(input, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
  if (setter) setter.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

let fwdBanner = null;

function showForwardBanner(username) {
  if (fwdBanner) fwdBanner.remove();
  fwdBanner = document.createElement("div");
  fwdBanner.style.cssText = [
    "position:fixed", "top:16px", "left:50%", "transform:translateX(-50%)",
    "background:#ff0076", "color:#fff", "padding:10px 16px", "border-radius:8px",
    "font-size:13px", "font-weight:600", "z-index:2147483647",
    "box-shadow:0 4px 20px rgba(0,0,0,.4)", "font-family:system-ui,sans-serif",
    "display:flex", "align-items:center", "gap:10px", "white-space:nowrap",
  ].join(";");

  const msgEl = document.createElement("span");
  msgEl.textContent = username
    ? `📤 Forwarding to @${username}…`
    : `📤 Tap the voice message to forward`;

  const x = document.createElement("button");
  x.textContent = "✕";
  x.style.cssText = "background:none;border:none;color:rgba(255,255,255,.8);cursor:pointer;font-size:15px;padding:0;line-height:1;";
  x.onclick = async () => {
    fwdBanner?.remove();
    await chrome.storage.local.remove("pendingForward");
  };

  fwdBanner.append(msgEl, x);
  document.body.appendChild(fwdBanner);
  setTimeout(() => fwdBanner?.remove(), 90000);

  setTimeout(() => tryAutoForward(username, msgEl), 2500);
  return msgEl;
}

async function tryAutoForward(username, msgEl) {
  const update = (t) => { if (msgEl) msgEl.textContent = t; };

  const audio = document.querySelector("audio");
  if (!audio) {
    if (username) await navigator.clipboard.writeText(username).catch(() => {});
    update(username
      ? `📤 Tap voice message → Forward → paste @${username} (copied!)`
      : `📤 Tap voice message → Forward`);
    return;
  }

  const msgItem = audio.closest("[role='listitem']") ?? audio.parentElement;
  if (!msgItem) {
    if (username) await navigator.clipboard.writeText(username).catch(() => {});
    update(username
      ? `📤 Tap voice message → Forward → paste @${username} (copied!)`
      : `📤 Tap voice message → Forward`);
    return;
  }

  update(`📤 Opening forward dialog…`);
  msgItem.dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  msgItem.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true }));
  await sleep(500);

  const fwdBtn =
    document.querySelector('[aria-label="Forward"]') ??
    [...document.querySelectorAll('[role="button"]')].find(
      (b) => b.getAttribute("aria-label")?.toLowerCase().includes("forward")
    );

  if (!fwdBtn) {
    if (username) await navigator.clipboard.writeText(username).catch(() => {});
    update(username
      ? `📤 Tap voice message → Forward → paste @${username} (copied!)`
      : `📤 Tap voice message → Forward`);
    return;
  }

  fwdBtn.click();
  await sleep(800);

  const searchInput =
    document.querySelector('input[placeholder*="earch"]') ??
    document.querySelector('input[type="text"]');

  if (!searchInput) {
    if (username) await navigator.clipboard.writeText(username).catch(() => {});
    update(username ? `📤 Type @${username} in search (copied!)` : `📤 Search and send`);
    return;
  }

  if (username) {
    reactSet(searchInput, username);
    searchInput.focus();
    await sleep(1000);

    const result = [...document.querySelectorAll('[role="button"]')].find(
      (b) => b !== searchInput && b.textContent.toLowerCase().includes(username.toLowerCase())
    );

    if (result) {
      result.click();
      await sleep(400);
      update(`📤 Ready — tap Send to forward to @${username}!`);
    } else {
      update(`📤 Select @${username} from the list, then tap Send`);
    }
  } else {
    update(`📤 Search for your prospect and tap Send`);
    searchInput.focus();
  }

  await chrome.storage.local.remove("pendingForward");
}

async function checkPendingForward() {
  const { pendingForward } = await chrome.storage.local.get({ pendingForward: null });
  if (!pendingForward) return;
  if (Date.now() - pendingForward.ts > 60000) {
    await chrome.storage.local.remove("pendingForward");
    return;
  }
  showForwardBanner(pendingForward.toUsername);
}

// ─── Boot ─────────────────────────────────────────────────────────────────────

if (location.pathname.startsWith("/direct/")) {
  checkPendingForward();
} else {
  setInterval(checkPage, 500);
  checkPage();
}
