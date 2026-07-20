// Shared outbound queue → POST ${FANMAS_URL}/api/pulse/events.
// The ONLY network destination in this worker besides the Slack/WA reads.
const FLUSH_MS = 5_000;
const FLUSH_AT = 20; // messages buffered → flush early
const MAX_BUFFER = 1_000; // drop-oldest cap so a long outage can't OOM us
const MAX_PER_POST = 200; // server-side zod cap

export function createBatcher({ url, secret }) {
  const messages = [];
  const heartbeats = new Map(); // channel → detail (latest wins)
  const convoUpdates = new Map(); // channel|convoId → update (latest wins)
  let failures = 0;
  let flushing = false;

  async function flush(force = false) {
    if (flushing) return;
    if (!force && messages.length === 0 && heartbeats.size === 0 && convoUpdates.size === 0) return;
    // Exponential-ish backoff: after N consecutive failures skip N ticks (cap 6).
    if (failures > 0 && Math.random() > 1 / Math.min(failures + 1, 6)) return;

    flushing = true;
    const msgBatch = messages.slice(0, MAX_PER_POST);
    const hbBatch = [...heartbeats.entries()].map(([channel, detail]) => ({ channel, detail }));
    const cuBatch = [...convoUpdates.values()].slice(0, 500);
    try {
      const res = await fetch(`${url}/api/pulse/events`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${secret}`,
        },
        body: JSON.stringify({
          messages: msgBatch,
          heartbeats: hbBatch,
          convoUpdates: cuBatch,
        }),
      });
      if (!res.ok) throw new Error(`POST /api/pulse/events → ${res.status}`);
      messages.splice(0, msgBatch.length);
      // Delete only what THIS flush sent — a beat enqueued while the POST was
      // in flight must survive to the next flush (clear() here silently ate
      // every WhatsApp heartbeat that landed mid-flight).
      for (const b of hbBatch) {
        if (heartbeats.get(b.channel) === b.detail) heartbeats.delete(b.channel);
      }
      for (const u of cuBatch) convoUpdates.delete(`${u.channel}|${u.externalConvoId}`);
      const { ingested = 0, duplicates = 0 } = await res.json().catch(() => ({}));
      if (msgBatch.length > 0) {
        console.log(`[batcher] sent ${msgBatch.length} msgs (ingested ${ingested}, dup ${duplicates})`);
      }
      failures = 0;
    } catch (e) {
      failures++;
      console.error(`[batcher] flush failed (attempt ${failures}):`, e.message ?? e);
    } finally {
      flushing = false;
    }
  }

  setInterval(() => flush(), FLUSH_MS);

  return {
    enqueueMessage(m) {
      messages.push(m);
      if (messages.length > MAX_BUFFER) messages.splice(0, messages.length - MAX_BUFFER);
      if (messages.length >= FLUSH_AT) flush();
    },
    enqueueHeartbeat(channel, detail = {}) {
      heartbeats.set(channel, detail);
    },
    enqueueConvoUpdate(u) {
      convoUpdates.set(`${u.channel}|${u.externalConvoId}`, u);
    },
    flush,
  };
}
