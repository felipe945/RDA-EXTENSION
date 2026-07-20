// pulse-bridge — Felipe's Mac-side feed for FanMas Pulse (/accounts).
// One process, two read-only loops:
//   wa.mjs    — WhatsApp listener (Baileys, personal number, 1:1 chats only)
//   slack.mjs — Slack poller (Felipe's own user token, every 5 min)
// Both feed batcher.mjs → POST /api/pulse/events (Bearer PULSE_BRIDGE_SECRET).
//
// ⛔ This worker NEVER sends a message anywhere. Read-only, permanently.
import "dotenv/config";
import { createBatcher } from "./batcher.mjs";
import { startSlack } from "./slack.mjs";
import { startWhatsApp } from "./wa.mjs";

const url = process.env.FANMAS_URL;
const secret = process.env.PULSE_BRIDGE_SECRET;
if (!url || !secret) {
  console.error("Set FANMAS_URL and PULSE_BRIDGE_SECRET in workers/pulse-bridge/.env first.");
  process.exit(1);
}

const batcher = createBatcher({ url: url.replace(/\/$/, ""), secret });

process.on("unhandledRejection", (e) => console.error("[pulse-bridge] unhandled rejection:", e));
process.on("uncaughtException", (e) => console.error("[pulse-bridge] uncaught exception:", e));

// Preflight: don't start reading (and advancing Slack cursors) until the
// server actually accepts our posts — a misconfigured server would otherwise
// mean read-then-dropped history once the retry buffer caps out.
async function waitForServer() {
  for (;;) {
    try {
      const res = await fetch(`${url.replace(/\/$/, "")}/api/pulse/events`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${secret}` },
        body: "{}",
      });
      if (res.ok) return;
      const body = await res.json().catch(() => ({}));
      console.log(`[pulse-bridge] server not ready (${res.status} ${body.error ?? ""}) — retrying in 30s`);
    } catch (e) {
      console.log(`[pulse-bridge] server unreachable (${e.message}) — retrying in 30s`);
    }
    await new Promise((r) => setTimeout(r, 30_000));
  }
}
await waitForServer();
console.log(`[pulse-bridge] server accepted preflight — feeding ${url}`);
if (process.env.SKIP_WA === "1") {
  console.log("[pulse-bridge] SKIP_WA=1 — WhatsApp loop disabled");
} else {
  startWhatsApp(batcher).catch((e) => console.error("[wa] fatal:", e));
}
startSlack(batcher).catch((e) => console.error("[slack] fatal:", e));
