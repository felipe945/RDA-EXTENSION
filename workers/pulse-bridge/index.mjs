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

console.log(`[pulse-bridge] feeding ${url}`);
if (process.env.SKIP_WA === "1") {
  console.log("[pulse-bridge] SKIP_WA=1 — WhatsApp loop disabled");
} else {
  startWhatsApp(batcher).catch((e) => console.error("[wa] fatal:", e));
}
startSlack(batcher).catch((e) => console.error("[slack] fatal:", e));
