// WhatsApp listener (Baileys, unofficial WhatsApp-Web protocol).
// ⛔ READ-ONLY INVARIANT: this module NEVER calls any send/presence API on the
// socket — only event listeners + fetches to FanMas. Grep before you ship.
// Handles BOTH upsert types: "notify" (live) and "append" (offline catch-up
// after the worker was down) — the server dedupes on external ids.
import { fileURLToPath } from "node:url";
import path from "node:path";
import makeWASocket, {
  useMultiFileAuthState,
  DisconnectReason,
  fetchLatestBaileysVersion,
} from "baileys";
import qrcode from "qrcode-terminal";

const AUTH_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "auth");
const RECONNECT_MS = 5_000;

// Unwrap the envelope WhatsApp sometimes puts around real content.
function unwrap(message) {
  return (
    message?.ephemeralMessage?.message ??
    message?.viewOnceMessage?.message ??
    message?.viewOnceMessageV2?.message ??
    message
  );
}

function extractText(message) {
  const m = unwrap(message);
  if (!m) return null;
  if (m.protocolMessage || m.reactionMessage || m.pollUpdateMessage) return null; // not a message
  const text =
    m.conversation ??
    m.extendedTextMessage?.text ??
    m.imageMessage?.caption ??
    m.videoMessage?.caption ??
    m.documentMessage?.caption;
  if (text) return text;
  if (m.imageMessage || m.videoMessage || m.audioMessage || m.documentMessage || m.stickerMessage) {
    return "[media]";
  }
  return null;
}

export async function startWhatsApp(batcher) {
  const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
  let connected = false;

  async function connect() {
    // Announce the CURRENT WhatsApp-Web version — a stale hardcoded one gets
    // rejected with 405 at registration (the classic Baileys gotcha).
    const { version } = await fetchLatestBaileysVersion().catch(() => ({ version: undefined }));
    const sock = makeWASocket({ version, auth: state, syncFullHistory: false });
    sock.ev.on("creds.update", saveCreds);

    sock.ev.on("connection.update", ({ connection, lastDisconnect, qr }) => {
      if (qr) {
        console.log("\n[wa] Scan this QR with WhatsApp → Settings → Linked Devices:\n");
        qrcode.generate(qr, { small: true });
      }
      if (connection === "open") {
        connected = true;
        console.log("[wa] connected");
      }
      if (connection === "close") {
        connected = false;
        const code = lastDisconnect?.error?.output?.statusCode;
        if (code === DisconnectReason.loggedOut) {
          console.error("[wa] LOGGED OUT — delete workers/pulse-bridge/auth/ and re-scan the QR.");
          return; // don't reconnect a dead session
        }
        console.log(`[wa] connection closed (${code ?? "?"}) — reconnecting in ${RECONNECT_MS / 1000}s`);
        setTimeout(() => connect().catch((e) => console.error("[wa] reconnect failed", e)), RECONNECT_MS);
      }
    });

    sock.ev.on("messages.upsert", ({ messages, type }) => {
      if (type !== "notify" && type !== "append") return;
      for (const m of messages) {
        try {
          handleMessage(m);
        } catch (e) {
          console.error("[wa] message handling failed", e);
        }
      }
    });
  }

  function handleMessage(m) {
    const jid = m.key?.remoteJid;
    // 1:1 chats only — skip groups (@g.us), status broadcast, newsletters.
    if (!jid || !jid.endsWith("@s.whatsapp.net")) return;
    if (!m.key.id || !m.message) return;
    const body = extractText(m.message);
    if (body == null) return;

    const tsRaw = m.messageTimestamp;
    const ts = typeof tsRaw === "number" ? tsRaw : Number(tsRaw ?? 0);
    if (!ts) return;

    batcher.enqueueMessage({
      channel: "whatsapp",
      externalConvoId: jid,
      externalMsgId: m.key.id,
      direction: m.key.fromMe ? "out" : "in",
      author: m.key.fromMe ? undefined : (m.pushName ?? undefined),
      body,
      sentAt: new Date(ts * 1000).toISOString(),
      displayName: m.key.fromMe ? undefined : (m.pushName ?? undefined),
      meta: { phone: jid.split("@")[0] },
    });
  }

  connect().catch((e) => console.error("[wa] initial connect failed", e));
  setInterval(() => batcher.enqueueHeartbeat("whatsapp", { wa_connected: connected }), 60_000);
  batcher.enqueueHeartbeat("whatsapp", { wa_connected: false, booting: true });
}
