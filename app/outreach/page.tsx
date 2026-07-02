"use client";

import { useState, useCallback, useEffect } from "react";
import { useLeads } from "@/hooks/useLeads";
import { useMode } from "@/components/ModeProvider";
import type { Lead } from "@/hooks/useLeads";
import { IgHandle, igDmUrl, igProfileUrl, isSnoozed, type LeadPlus } from "@/components/ig";
import { SnoozeControl } from "@/components/SnoozeControl";

type Channel = "ig" | "email" | "linkedin";

const CHANNEL_LABELS: Record<Channel, string> = { ig: "Instagram", email: "Email", linkedin: "LinkedIn" };

function getOpener(lead: Lead, channel: Channel): string {
  const cache = lead.research_cache as Record<string, unknown> | null;
  if (!cache) return "";
  const openers = cache.openers as Record<string, unknown> | null;
  const val = openers?.[channel];
  if (channel === "email" && val && typeof val === "object") {
    const e = val as { subject?: string; body?: string };
    return [e.subject ? `Subject: ${e.subject}` : "", e.body ?? ""].filter(Boolean).join("\n\n");
  }
  if (typeof val === "string" && val) return val;
  return (cache.suggestedOpener as string) ?? "";
}

function fitColor(score: number) {
  if (score >= 75) return "#22c55e";
  if (score >= 50) return "#f59e0b";
  return "#ef4444";
}

function formatFollowers(n: number | null) {
  if (!n) return null;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(0)}K`;
  return String(n);
}

const SKIP_STAGES = ["DM Sent", "Replied", "Qualifying", "Call Offered", "Booked", "Closed", "DQ", "Blocked"];

export default function OutreachPage() {
  const { mode } = useMode();
  const { leads: allLeadsRaw, refresh } = useLeads(mode);
  const [channel, setChannel] = useState<Channel>("ig");
  const [idx, setIdx] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState<false | "sent" | "dq" | "blocked">(false);
  const [pendingUndo, setPendingUndo] = useState<{
    lead: Lead; opener: string; note: string; timer: ReturnType<typeof setTimeout>;
  } | null>(null);

  // Snoozed leads sit out of the queue until snoozed_until passes (C4 —
  // server-persisted, shared with the extension).
  const allLeads = (allLeadsRaw as LeadPlus[]).filter(
    (l) => !SKIP_STAGES.includes(l.stage) && !isSnoozed(l),
  );

  const queued = allLeads.filter((l) => {
    if (channel === "ig") return l.source === "IG" || !!l.ig_username;
    if (channel === "email") return !!l.email;
    if (channel === "linkedin") return !!l.linkedin_url;
    return true;
  });

  const lead = queued[idx] ?? null;
  const opener = lead ? getOpener(lead, channel) : "";

  const copyOpener = useCallback(() => {
    if (!opener) return;
    navigator.clipboard.writeText(opener).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [opener]);

  // C7: the primary "open" is the profile page, not the DM thread — matches
  // the extension. openDm stays as the secondary action.
  function openProfile() {
    if (!lead) return;
    if (channel === "ig") {
      const url = lead.ig_username
        ? igProfileUrl(lead.ig_username)
        : lead.ig_profile_url;
      if (url) window.open(url, "_blank");
    } else if (channel === "linkedin" && lead.linkedin_url) {
      window.open(lead.linkedin_url, "_blank");
    } else if (channel === "email" && lead.email) {
      const openers = (lead.research_cache ?? {}).openers as Record<string, unknown> | undefined;
      const subject = (openers?.["email"] as { subject?: string } | undefined)?.subject ?? "";
      window.open(`mailto:${lead.email}?subject=${encodeURIComponent(subject)}`, "_blank");
    }
  }

  function openAndCopy() {
    copyOpener();
    openProfile();
  }

  function openDm() {
    if (!lead?.ig_username) return;
    window.open(igDmUrl(lead.ig_username), "_blank");
  }

  async function markSent() {
    if (!lead || saving || pendingUndo) return;

    const capturedLead = lead;
    const capturedOpener = opener;
    const capturedNote = note;

    setDoneCount((c) => c + 1);
    setNote("");
    setCopied(false);
    setIdx((i) => Math.min(i, Math.max(0, queued.length - 2)));

    const timer = setTimeout(async () => {
      setPendingUndo(null);
      const now = new Date().toISOString();
      const dueAt = new Date(Date.now() + 3 * 24 * 3600000).toISOString();
      setSaving("sent");
      await fetch("/api/leads", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: capturedLead.id,
          stage: "DM Sent",
          last_contact_at: now,
          due_at: dueAt,
          dm_sent_at: now,
          updated_at: now,
        }),
      });
      if (capturedOpener || capturedNote) {
        await fetch("/api/messages", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            lead_id: capturedLead.id,
            channel,
            direction: "outbound",
            body: [capturedOpener, capturedNote].filter(Boolean).join("\n\n---\n") || null,
            from_address: null,
            to_address: capturedLead.ig_username
              ? `@${capturedLead.ig_username}`
              : capturedLead.email ?? capturedLead.phone ?? null,
            sent_from_handle: null,
            raw: channel === "email" && capturedLead.research_cache?.openers
              ? (capturedLead.research_cache.openers as Record<string, unknown>)["email"] ?? null
              : null,
            created_at: now,
          }),
        });
      }
      setSaving(false);
      await refresh();
    }, 5000);

    setPendingUndo({ lead: capturedLead, opener: capturedOpener, note: capturedNote, timer });
  }

  function undoSent() {
    if (!pendingUndo) return;
    clearTimeout(pendingUndo.timer);
    setPendingUndo(null);
    setDoneCount((c) => Math.max(0, c - 1));
    setNote(pendingUndo.note);
    const restoredIdx = queued.findIndex((l) => l.id === pendingUndo.lead.id);
    setIdx(restoredIdx >= 0 ? restoredIdx : 0);
  }

  useEffect(() => {
    return () => { if (pendingUndo) clearTimeout(pendingUndo.timer); };
  }, [pendingUndo]);

  async function markStage(stage: "DQ" | "Blocked") {
    if (!lead || saving) return;
    setSaving(stage === "DQ" ? "dq" : "blocked");
    const now = new Date().toISOString();

    await fetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: lead.id, stage, updated_at: now }),
    });

    setNote("");
    setCopied(false);
    setSaving(false);
    await refresh();
    setIdx((i) => Math.min(i, Math.max(0, queued.length - 2)));
  }

  function skip() {
    setIdx((i) => (i + 1) % Math.max(queued.length, 1));
    setNote("");
    setCopied(false);
  }

  const cache = (lead?.research_cache ?? {}) as Record<string, unknown>;
  const fitScore = typeof cache.fitScore === "number" ? cache.fitScore : null;
  const stack = Array.isArray(cache.stackDetected) ? (cache.stackDetected as string[]) : [];
  const summary = typeof cache.summary === "string" ? cache.summary : null;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-lg font-semibold text-white">Outreach Queue</h1>
          <p className="text-xs text-gray-500 mt-0.5">
            {doneCount > 0 && <span className="text-green-400 font-medium">{doneCount} sent today · </span>}
            {queued.length} leads to contact
          </p>
        </div>
        {/* Channel tabs */}
        <div className="flex gap-1 bg-gray-900 rounded-lg p-1">
          {(["ig", "email", "linkedin"] as Channel[]).map((c) => {
            const count = allLeads.filter((l) => {
              if (c === "ig") return l.source === "IG" || !!l.ig_username;
              if (c === "email") return !!l.email;
              if (c === "linkedin") return !!l.linkedin_url;
              return false;
            }).length;
            return (
              <button
                key={c}
                onClick={() => { setChannel(c); setIdx(0); }}
                className={`px-3 py-1 rounded-md text-xs font-medium transition-colors ${
                  channel === c ? "bg-[#FF3A69] text-white" : "text-gray-400 hover:text-gray-200"
                }`}
              >
                {CHANNEL_LABELS[c]} {count > 0 && <span className="opacity-60">({count})</span>}
              </button>
            );
          })}
        </div>
      </div>

      {/* Progress bar */}
      {queued.length > 0 && (
        <div className="mb-6">
          <div className="flex justify-between text-xs text-gray-500 mb-1.5">
            <span>{idx + 1} of {queued.length}</span>
            <span>{Math.round((doneCount / Math.max(queued.length + doneCount, 1)) * 100)}% done</span>
          </div>
          <div className="bg-gray-800 rounded-full h-1">
            <div
              className="bg-[#FF3A69] h-1 rounded-full transition-all"
              style={{ width: `${(doneCount / Math.max(queued.length + doneCount, 1)) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* Undo toast */}
      {pendingUndo && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gray-800 border border-gray-600 rounded-xl px-4 py-3 shadow-2xl">
          <span className="text-sm text-gray-200">
            DM logged for {pendingUndo.lead.ig_username ? `@${pendingUndo.lead.ig_username}` : "lead"}
          </span>
          <button
            onClick={undoSent}
            className="text-xs font-semibold text-[#FF3A69] hover:text-[#e03060] border border-[#FF3A69]/40 rounded-md px-3 py-1 transition-colors"
          >
            Undo
          </button>
          <span className="text-xs text-gray-600">5s</span>
        </div>
      )}

      {queued.length === 0 ? (
        <div className="text-center py-20 space-y-2">
          <p className="text-3xl">🎉</p>
          <p className="text-white font-medium">Queue cleared</p>
          <p className="text-sm text-gray-500">All {CHANNEL_LABELS[channel]} leads have been contacted.</p>
        </div>
      ) : !lead ? null : (
        <div className="space-y-4">
          {/* Lead card */}
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-5">
            <div className="flex items-start justify-between mb-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xl font-bold text-white">
                    {lead.ig_username
                      ? <IgHandle handle={lead.ig_username} className="text-white" />
                      : (lead.name ?? "Unnamed")}
                  </span>
                  {lead.follower_count && (
                    <span className="text-sm text-gray-500">{formatFollowers(lead.follower_count)} followers</span>
                  )}
                </div>
                {lead.name && lead.ig_username && lead.name !== lead.ig_username && (
                  <p className="text-sm text-gray-500 mt-0.5">{lead.name}</p>
                )}
              </div>
              {fitScore !== null && (
                <div className="text-right">
                  <span className="text-2xl font-bold" style={{ color: fitColor(fitScore) }}>{fitScore}</span>
                  <p className="text-xs text-gray-500">fit score</p>
                </div>
              )}
            </div>

            {fitScore !== null && (
              <div className="bg-gray-800 rounded-full h-1 mb-3">
                <div className="h-1 rounded-full" style={{ width: `${fitScore}%`, background: fitColor(fitScore) }} />
              </div>
            )}

            {stack.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-3">
                {stack.map((s) => (
                  <span key={s} className="text-xs bg-gray-800 border border-gray-700 px-2 py-0.5 rounded-full text-gray-400">
                    {s}
                  </span>
                ))}
              </div>
            )}

            {summary && (
              <p className="text-sm text-gray-400 leading-relaxed mb-3 border-t border-gray-800 pt-3">{summary}</p>
            )}

            {lead.research_status === "pending" && (
              <div className="flex items-center gap-2 text-xs text-gray-500 mb-3 border-t border-gray-800 pt-3">
                <span className="w-1.5 h-1.5 rounded-full bg-[#FF3A69] animate-pulse inline-block" />
                Research in progress — opener will appear shortly
              </div>
            )}
          </div>

          {/* Opener */}
          {opener ? (
            <div className="bg-gray-950 border border-gray-700 rounded-xl p-4 space-y-3">
              <div className="flex items-center justify-between">
                <p className="text-xs text-gray-500 uppercase tracking-wide">{CHANNEL_LABELS[channel]} Opener</p>
                <span className="text-xs text-gray-600">max {channel === "ig" ? "100" : "150"} words</span>
              </div>
              <p className="text-sm text-gray-200 leading-relaxed whitespace-pre-wrap">{opener}</p>
            </div>
          ) : (
            <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3">
              <p className="text-sm text-gray-600 text-center">
                {lead.research_status === "pending"
                  ? "Opener generating... refresh in ~30s"
                  : lead.research_status === "error"
                  ? "Research failed."
                  : "No opener yet."}
              </p>
              {(lead.research_status === "none" || lead.research_status === "error") && (
                <button
                  onClick={async () => {
                    await fetch("/api/ai/research-lead", {
                      method: "POST",
                      headers: { "Content-Type": "application/json" },
                      body: JSON.stringify({ leadId: lead.id, force: true }),
                    });
                    await refresh();
                  }}
                  className="w-full text-xs py-2 border border-gray-700 rounded-lg text-gray-400 hover:text-white hover:border-[#FF3A69] transition-colors"
                >
                  Research this lead →
                </button>
              )}
            </div>
          )}

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a personal note to append (optional)..."
            rows={2}
            className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 placeholder-gray-700 resize-none outline-none focus:border-gray-600"
          />

          {/* Primary action */}
          <div className="grid grid-cols-2 gap-3">
            <button
              onClick={openAndCopy}
              className="flex items-center justify-center gap-2 px-4 py-3 bg-[#FF3A69] hover:bg-[#e03060] text-white font-semibold rounded-lg transition-colors text-sm"
            >
              {copied ? "✓ Copied!" : (
                <><span>Open {CHANNEL_LABELS[channel]}</span><span className="opacity-70">+ Copy</span></>
              )}
            </button>
            <button
              onClick={markSent}
              disabled={!!saving || !!pendingUndo}
              className="px-4 py-3 bg-green-900 hover:bg-green-800 border border-green-700 text-green-300 font-semibold rounded-lg transition-colors text-sm disabled:opacity-50"
            >
              {saving === "sent" ? "Saving..." : pendingUndo ? "Queued…" : "✓ DM Sent"}
            </button>
          </div>

          {/* Snooze — server-persisted, shared with the extension */}
          <div className="flex items-center justify-between rounded-lg border border-gray-800 bg-gray-900 px-3 py-2">
            <SnoozeControl
              lead={lead}
              onSnoozed={async () => {
                setNote("");
                setCopied(false);
                await refresh();
                setIdx((i) => Math.min(i, Math.max(0, queued.length - 2)));
              }}
            />
            {lead.ig_username && (
              <button
                onClick={openDm}
                className="rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-500 transition-colors hover:border-gray-500 hover:text-gray-300"
                title="Open the Instagram DM thread"
              >
                Open DM ↗
              </button>
            )}
          </div>

          {/* Secondary actions */}
          <div className="flex gap-2">
            <button
              onClick={() => markStage("DQ")}
              disabled={!!saving}
              className="flex-1 px-3 py-2 bg-gray-900 hover:bg-red-950 border border-gray-800 hover:border-red-900 text-gray-500 hover:text-red-400 rounded-lg transition-colors text-xs font-medium disabled:opacity-50"
            >
              {saving === "dq" ? "Saving..." : "DQ"}
            </button>
            <button
              onClick={() => markStage("Blocked")}
              disabled={!!saving}
              className="flex-1 px-3 py-2 bg-gray-900 hover:bg-orange-950 border border-gray-800 hover:border-orange-900 text-gray-500 hover:text-orange-400 rounded-lg transition-colors text-xs font-medium disabled:opacity-50"
            >
              {saving === "blocked" ? "Saving..." : "Blocked"}
            </button>
            <button
              onClick={skip}
              className="flex-1 px-3 py-2 bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-500 hover:text-gray-300 rounded-lg transition-colors text-xs font-medium"
            >
              Skip →
            </button>
            <a
              href={`/leads/${lead.id}`}
              className="flex-1 px-3 py-2 bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-500 hover:text-gray-300 rounded-lg transition-colors text-xs font-medium text-center"
            >
              Profile
            </a>
          </div>
        </div>
      )}
    </div>
  );
}
