// Slack poller — reads as FELIPE (user xoxp token, read-only scopes, no bot,
// no app presence). Plain fetch against slack.com/api — no SDK.
// ⛔ READ-ONLY INVARIANT: only conversations.*/users.*/auth.test are ever
// called. No chat.postMessage, ever.
//
// Self-healing: per-channel cursors persist in state.json, so downtime is
// backfilled on the next sweep (floor: 7 days on first run).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const STATE_PATH = path.join(path.dirname(fileURLToPath(import.meta.url)), "state.json");
const POLL_MS = 5 * 60_000;
const CALL_GAP_MS = 1_500; // ≤40 req/min — under Slack's Tier-3 (~50/min) limit
const FIRST_RUN_FLOOR_MS = 7 * 24 * 3_600_000;
const HISTORY_PAGE_LIMIT = 100;
const MAX_HISTORY_PAGES = 5;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function loadState() {
  try {
    return { cursors: {}, lastRead: {}, users: {}, lastDir: {}, ...JSON.parse(fs.readFileSync(STATE_PATH, "utf8")) };
  } catch {
    return { cursors: {}, lastRead: {}, users: {}, lastDir: {} };
  }
}
function saveState(state) {
  fs.writeFileSync(STATE_PATH, JSON.stringify(state, null, 2));
}

export async function startSlack(batcher) {
  const token = process.env.SLACK_USER_TOKEN;
  if (!token) {
    console.log("[slack] SLACK_USER_TOKEN not set — Slack loop disabled (WA still runs)");
    return;
  }

  const state = loadState();
  let lastChannelCount = 0;
  let healthy = false;
  let ME, TEAM; // set at boot by auth.test

  async function api(method, params = {}) {
    await sleep(CALL_GAP_MS);
    const qs = new URLSearchParams(
      Object.fromEntries(Object.entries(params).filter(([, v]) => v != null))
    );
    const res = await fetch(`https://slack.com/api/${method}?${qs}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (res.status === 429) {
      const retry = Number(res.headers.get("retry-after") ?? 30);
      console.log(`[slack] rate limited on ${method} — waiting ${retry}s`);
      await sleep(retry * 1000);
      return api(method, params);
    }
    const data = await res.json();
    if (!data.ok) throw new Error(`${method}: ${data.error}`);
    return data;
  }

  // Resolve author name + SIDE. FanBasis teammates (full members of our
  // workspace) count as OUR side — a colleague answering the client answers
  // for Felipe. Clients = Slack Connect externals (different team_id) or
  // single/multi-channel guests (is_restricted flags).
  async function userInfo(userId) {
    if (!userId) return { name: undefined, isTeam: false };
    const cached = state.users[userId];
    if (cached && typeof cached === "object") return cached;
    try {
      const { user } = await api("users.info", { user: userId });
      const info = {
        name: user?.profile?.display_name || user?.real_name || user?.name || userId,
        isTeam:
          user?.team_id === TEAM &&
          !user?.is_restricted &&
          !user?.is_ultra_restricted &&
          !user?.is_bot,
      };
      state.users[userId] = info; // replaces legacy string cache entries too
      return info;
    } catch {
      return { name: typeof cached === "string" ? cached : userId, isTeam: false };
    }
  }

  async function listChannels() {
    const channels = [];
    let cursor;
    do {
      const data = await api("users.conversations", {
        types: "public_channel,private_channel,im,mpim",
        exclude_archived: "true",
        limit: "200",
        cursor,
      });
      channels.push(...(data.channels ?? []));
      cursor = data.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return channels;
  }

  // direction = SIDE: "out" for anyone on our team (Felipe OR a colleague),
  // "in" only for the client side. The engine's owe/fire logic keys off this.
  function mapMessage(m, channelId, displayName, info) {
    const isUs = m.user === ME || info.isTeam;
    return {
      channel: "slack",
      externalConvoId: channelId,
      externalMsgId: m.ts,
      direction: isUs ? "out" : "in",
      author: m.user === ME ? "Felipe" : info.name,
      body: m.text ?? "",
      sentAt: new Date(Number(m.ts) * 1000).toISOString(),
      displayName,
      meta: { team_id: TEAM },
    };
  }

  async function sweep() {
    const channels = await listChannels();
    lastChannelCount = channels.length;

    for (const ch of channels) {
      try {
        const displayName = ch.is_im
          ? (await userInfo(ch.user)).name
          : ch.name
            ? `#${ch.name}`
            : ch.id;
        const floor = String((Date.now() - FIRST_RUN_FLOOR_MS) / 1000);
        const cursor = state.cursors[ch.id] ?? floor;
        let maxTs = Number(cursor);
        let oldest = cursor;
        let pages = 0;
        let hasMore = true;
        const parentsWithNewReplies = [];

        while (hasMore && pages < MAX_HISTORY_PAGES) {
          const data = await api("conversations.history", {
            channel: ch.id,
            oldest,
            limit: String(HISTORY_PAGE_LIMIT),
          });
          pages++;
          hasMore = !!data.has_more;
          const msgs = data.messages ?? []; // newest-first
          for (const m of msgs) {
            if (Number(m.ts) > maxTs) maxTs = Number(m.ts);
            // Threads: pull replies when a parent has activity past our cursor.
            if (m.reply_count && Number(m.latest_reply ?? 0) > Number(cursor)) {
              parentsWithNewReplies.push(m.ts);
            }
            if (m.subtype || m.bot_id || !m.ts) continue;
            const info = m.user === ME ? { name: "Felipe", isTeam: true } : await userInfo(m.user);
            const mapped = mapMessage(m, ch.id, displayName, info);
            batcher.enqueueMessage(mapped);
            if (!state.lastDir[ch.id] || Number(m.ts) >= maxTs) {
              state.lastDir[ch.id] = mapped.direction;
            }
          }
          if (hasMore && msgs.length > 0) oldest = msgs[msgs.length - 1].ts;
        }

        for (const parentTs of parentsWithNewReplies) {
          const data = await api("conversations.replies", {
            channel: ch.id,
            ts: parentTs,
            oldest: cursor,
            limit: String(HISTORY_PAGE_LIMIT),
          });
          for (const m of data.messages ?? []) {
            if (m.ts === parentTs || Number(m.ts) <= Number(cursor)) continue; // parent / already seen
            if (m.subtype && m.subtype !== "thread_broadcast") continue;
            if (m.bot_id || !m.ts) continue;
            if (Number(m.ts) > maxTs) maxTs = Number(m.ts);
            const info = m.user === ME ? { name: "Felipe", isTeam: true } : await userInfo(m.user);
            const mapped = mapMessage(m, ch.id, displayName, info);
            batcher.enqueueMessage(mapped);
            state.lastDir[ch.id] = mapped.direction;
          }
        }

        state.cursors[ch.id] = String(maxTs);

        // Read cursor → "seen · no reply" detection. Only when the newest known
        // message is inbound (that's the only time seen-state matters).
        if (state.lastDir[ch.id] === "in") {
          const info = await api("conversations.info", { channel: ch.id });
          const lastRead = info.channel?.last_read;
          if (lastRead && lastRead !== state.lastRead[ch.id]) {
            state.lastRead[ch.id] = lastRead;
            batcher.enqueueConvoUpdate({
              channel: "slack",
              externalConvoId: ch.id,
              lastReadAt: new Date(Number(lastRead) * 1000).toISOString(),
            });
          }
        }
      } catch (e) {
        console.error(`[slack] sweep failed for ${ch.id}:`, e.message ?? e);
      }
    }
    saveState(state);
  }

  // Boot: identify Felipe + the workspace, then sweep forever.
  try {
    const auth = await api("auth.test");
    ME = auth.user_id;
    TEAM = auth.team_id;
    healthy = true;
    console.log(`[slack] polling as ${auth.user} (${ME}) in team ${TEAM}`);
  } catch (e) {
    console.error("[slack] auth.test failed — check SLACK_USER_TOKEN:", e.message ?? e);
    return;
  }

  setInterval(
    () => batcher.enqueueHeartbeat("slack", { channels_polled: lastChannelCount, healthy }),
    60_000
  );

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const started = Date.now();
    try {
      await sweep();
      healthy = true;
    } catch (e) {
      healthy = false;
      console.error("[slack] sweep error:", e.message ?? e);
    }
    const elapsed = Date.now() - started;
    if (elapsed < POLL_MS) await sleep(POLL_MS - elapsed);
  }
}
