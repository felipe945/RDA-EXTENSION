// outreach-queue.js — SINGLE source of truth for outreach queue filtering, sorting,
// and batch-progress math. Loaded in BOTH the sidepanel and the IG content script.
// Do NOT fork this logic back into sidepanel.js / instagram.js.
(function () {
  const DONE_STAGES = ["DM Sent", "Replied", "Qualifying", "Call Offered", "Booked", "Closed", "DQ", "Active", "Churned", "Blocked"];

  // "Reached out" line: leads at/after these stages have been contacted on this channel.
  const CONTACTED_STAGES = ["DM Sent", "Replied", "Qualifying", "Call Offered", "Booked", "Active"];

  // Dead stages excluded from the addressable batch entirely.
  const DEAD_STAGES = ["DQ", "Closed", "Churned", "Blocked"];

  // Sort/display parity: sort by the SAME number the card shows (fitScore), fall back to heuristic score.
  function sortScore(lead) {
    const cache = lead.research_cache || {};
    return typeof cache.fitScore === "number" ? cache.fitScore : (lead.score ?? 0);
  }

  function hasChannel(lead, channel) {
    if (channel === "ig") return !!(lead.ig_username || lead.ig_profile_url);
    if (channel === "linkedin") return !!lead.linkedin_url;
    return true;
  }

  function isSnoozed(lead, snoozed, now) {
    const until = snoozed && snoozed[lead.id];
    return !!until && until > (now == null ? Date.now() : now);
  }

  // Canonical OPEN queue: not-done, not-snoozed, has the channel, sorted by displayed score desc.
  function buildQueue(leads, opts) {
    opts = opts || {};
    const channel = opts.channel || "ig";
    const snoozed = opts.snoozed || {};
    const now = opts.now == null ? Date.now() : opts.now;
    return (leads || [])
      .filter((l) => !DONE_STAGES.includes(l.stage))
      .filter((l) => !isSnoozed(l, snoozed, now))
      .filter((l) => hasChannel(l, channel))
      .sort((a, b) => sortScore(b) - sortScore(a));
  }

  // Batch progress = reached-out share of the addressable batch (contacted + still-open),
  // NOT cursor position. This is the number the % bar must use.
  function computeBatchProgress(leads, opts) {
    opts = opts || {};
    const channel = opts.channel || "ig";
    const addressable = (leads || []).filter((l) => hasChannel(l, channel) && !DEAD_STAGES.includes(l.stage));
    const total = addressable.length;
    const contacted = addressable.filter((l) => CONTACTED_STAGES.includes(l.stage)).length;
    const pct = total ? Math.round((contacted / total) * 100) : 0;
    return { contacted, total, pct };
  }

  window.FBQueue = { DONE_STAGES, CONTACTED_STAGES, DEAD_STAGES, sortScore, hasChannel, buildQueue, computeBatchProgress };
})();
