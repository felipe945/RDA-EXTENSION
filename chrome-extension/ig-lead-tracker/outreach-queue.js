// GENERATED from lib/queue.ts by pack-extension.sh — DO NOT EDIT. Edit lib/queue.ts and re-run npm run pack:ext.
"use strict";
var FBQueue = (() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __hasOwnProp = Object.prototype.hasOwnProperty;
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };
  var __copyProps = (to, from, except, desc) => {
    if (from && typeof from === "object" || typeof from === "function") {
      for (let key of __getOwnPropNames(from))
        if (!__hasOwnProp.call(to, key) && key !== except)
          __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
    }
    return to;
  };
  var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

  // lib/queue.ts
  var queue_exports = {};
  __export(queue_exports, {
    ALL_STAGES: () => ALL_STAGES,
    CONTACTED_STAGES: () => CONTACTED_STAGES,
    DEAD_STAGES: () => DEAD_STAGES,
    DONE_STAGES: () => DONE_STAGES,
    buildQueue: () => buildQueue,
    computeBatchProgress: () => computeBatchProgress,
    hasChannel: () => hasChannel,
    isSnoozed: () => isSnoozed,
    sortScore: () => sortScore
  });

  // lib/stages.ts
  var STAGES = [
    "New",
    "DM Sent",
    "Replied",
    "Call Offered",
    "Booked",
    "DQ"
  ];
  var DONE_STAGES = [
    "DM Sent",
    "Replied",
    "Qualifying",
    "Call Offered",
    "Booked",
    "Closed",
    "DQ",
    "Active",
    "Churned"
  ];
  var CONTACTED_STAGES = [
    "DM Sent",
    "Replied",
    "Qualifying",
    "Call Offered",
    "Booked",
    "Active"
  ];
  var DEAD_STAGES = ["DQ", "Closed", "Churned"];

  // lib/queue.ts
  var ALL_STAGES = STAGES;
  function resolveOpts(arg) {
    if (typeof arg === "string") return { channel: arg, snoozed: {}, now: Date.now() };
    return {
      channel: arg?.channel ?? "ig",
      snoozed: arg?.snoozed ?? {},
      now: arg?.now ?? Date.now()
    };
  }
  function isSnoozed(lead, snoozed, now) {
    const t = now == null ? Date.now() : now;
    if (lead.snoozed_until && new Date(lead.snoozed_until).getTime() > t) return true;
    const until = snoozed && snoozed[lead.id];
    return !!until && until > t;
  }
  function sortScore(lead) {
    const cache = lead.research_cache ?? {};
    return typeof cache.fitScore === "number" ? cache.fitScore : lead.score ?? 0;
  }
  function hasChannel(lead, channel) {
    if (channel === "ig") return !!(lead.ig_username || lead.ig_profile_url);
    if (channel === "email") return !!lead.email;
    if (channel === "linkedin") return !!lead.linkedin_url;
    return true;
  }
  function buildQueue(leads, arg) {
    const { channel, snoozed, now } = resolveOpts(arg);
    return (leads ?? []).filter((l) => !DONE_STAGES.includes(l.stage)).filter((l) => !isSnoozed(l, snoozed, now)).filter((l) => hasChannel(l, channel)).sort((a, b) => sortScore(b) - sortScore(a));
  }
  function computeBatchProgress(leads, arg) {
    const { channel } = resolveOpts(arg);
    const addressable = (leads ?? []).filter(
      (l) => hasChannel(l, channel) && !DEAD_STAGES.includes(l.stage)
    );
    const total = addressable.length;
    const contacted = addressable.filter((l) => CONTACTED_STAGES.includes(l.stage)).length;
    const pct = total ? Math.round(contacted / total * 100) : 0;
    return { contacted, total, pct };
  }
  return __toCommonJS(queue_exports);
})();
if(typeof window!=='undefined')window.FBQueue=FBQueue;
