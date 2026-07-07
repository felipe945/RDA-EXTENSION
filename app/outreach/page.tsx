"use client";

import { useState, useCallback, useEffect } from "react";
import Link from "next/link";
import { useLeads } from "@/hooks/useLeads";
import { useMode } from "@/components/ModeProvider";
import type { Lead } from "@/hooks/useLeads";
import { IgHandle, igOpenUrl, type LeadPlus } from "@/components/ig";
import { SnoozeControl } from "@/components/SnoozeControl";
import { TouchChips } from "@/components/TouchChips";
import BookCallModal from "@/components/BookCallModal";
import { buildQueue, computeBatchProgress, type QueueChannel } from "@/lib/queue";
import { scriptsForStage } from "@/lib/scripts";
import { stageColor } from "@/lib/stages";

type Channel = QueueChannel;

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

export default function OutreachPage() {
  const { mode } = useMode();
  const { leads: allLeadsRaw, refresh } = useLeads(mode);
  const [channel, setChannel] = useState<Channel>("ig");
  const [idx, setIdx] = useState(0);
  const [doneCount, setDoneCount] = useState(0);
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState("");
  const [saving, setSaving] = useState<false | "sent" | "dq">(false);
  const [generating, setGenerating] = useState(false);
  const [pendingUndo, setPendingUndo] = useState<{
    lead: Lead; opener: string; note: string; timer: ReturnType<typeof setTimeout>;
  } | null>(null);
  const [bookOpen, setBookOpen] = useState(false);
  const [scriptsOpen, setScriptsOpen] = useState(false);
  const [recentMsgs, setRecentMsgs] = useState<
    { id: string; channel: string; direction: string; body: string | null; created_at: string }[]
  >([]);

  // Queue + progress math come from lib/queue (FBQueue parity, Contract QUEUE):
  // open = not-done + not-snoozed + has-channel, sorted by displayed fit score.
  const allLeads = allLeadsRaw as LeadPlus[];
  const queued = buildQueue(allLeads, channel);
  const progress = computeBatchProgress(allLeads, channel);

  const lead = queued[idx] ?? null;
  const opener = lead ? getOpener(lead, channel) : "";

  const copyOpener = useCallback(() => {
    if (!opener) return;
    navigator.clipboard.writeText(opener).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [opener]);

  // THE primary action: copy the opener, open the prospect's PROFILE.
  // (A /direct/t/<username> "open the thread" URL doesn't exist — /direct/t/
  // takes a numeric thread id, so it lands on the Messages inbox. Profile +
  // opener-on-clipboard is the accurate flow; the rep taps Message there.)
  function primaryAction() {
    if (!lead) return;
    copyOpener();
    if (channel === "ig") {
      const url = igOpenUrl(lead);
      if (url) window.open(url, "_blank");
    } else if (channel === "linkedin" && lead.linkedin_url) {
      window.open(lead.linkedin_url, "_blank");
    } else if (channel === "email" && lead.email) {
      const openers = (lead.research_cache ?? {}).openers as Record<string, unknown> | undefined;
      const subject = (openers?.["email"] as { subject?: string } | undefined)?.subject ?? "";
      window.open(`mailto:${lead.email}?subject=${encodeURIComponent(subject)}`, "_blank");
    }
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

  // Last-4 message history for the current card — same context the
  // extension's "Recent Chats" gives before writing a DM.
  const leadId = lead?.id ?? null;
  useEffect(() => {
    setRecentMsgs([]);
    if (!leadId) return;
    let cancelled = false;
    fetch(`/api/messages?lead_id=${leadId}&limit=4`)
      .then((res) => (res.ok ? res.json() : null))
      .then((data: { messages?: typeof recentMsgs } | null) => {
        if (!cancelled && data?.messages) setRecentMsgs(data.messages);
      })
      .catch(() => {});
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leadId]);

  async function markDq() {
    if (!lead || saving) return;
    setSaving("dq");
    await fetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: lead.id, stage: "DQ", updated_at: new Date().toISOString() }),
    });
    setNote("");
    setCopied(false);
    setSaving(false);
    await refresh();
    setIdx((i) => Math.min(i, Math.max(0, queued.length - 2)));
  }

  // Every non-complete status gets a working path to an opener — pending,
  // enriched*, none, error alike. force regenerates off-type statuses
  // (T1's server guarantees generation for all of them).
  async function generateOpener() {
    if (!lead || generating) return;
    setGenerating(true);
    await fetch("/api/ai/research-lead", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ leadId: lead.id, force: true }),
    });
    setGenerating(false);
    await refresh();
  }

  function skip() {
    setIdx((i) => (i + 1) % Math.max(queued.length, 1));
    setNote("");
    setCopied(false);
  }

  function prev() {
    setIdx((i) => (i - 1 + Math.max(queued.length, 1)) % Math.max(queued.length, 1));
    setNote("");
    setCopied(false);
  }

  const cache = (lead?.research_cache ?? {}) as Record<string, unknown>;
  const fitScore = typeof cache.fitScore === "number" ? cache.fitScore : null;
  const stack = Array.isArray(cache.stackDetected) ? (cache.stackDetected as string[]) : [];
  const summary = typeof cache.summary === "string" ? cache.summary : null;
  const stageScriptCount = lead
    ? scriptsForStage(lead.stage).filter((s) =>
        channel === "email" ? s.category === "email" : s.category !== "email",
      ).length
    : 0;

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
            const count = buildQueue(allLeads, c).length;
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

      {/* ONE honest counter: your place in the queue, plus a plain-text
          contacted subline from server stage data (no second % bar). */}
      {progress.total > 0 && (
        <div className="mb-6 flex justify-between text-xs text-gray-500">
          <span>{queued.length > 0 ? `Card ${idx + 1} of ${queued.length}` : "Queue empty"}</span>
          <span>{progress.contacted} of {progress.total} contacted</span>
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

            {/* Stage as a read-only badge — the queue moves stages via DM Sent
                and DQ; anything exotic happens in lead detail. */}
            <div className="flex items-center justify-between gap-2 mb-3 flex-wrap">
              <span
                className="text-xs font-semibold px-2 py-0.5 rounded-full border"
                style={{ color: stageColor(lead.stage), borderColor: `${stageColor(lead.stage)}44`, background: `${stageColor(lead.stage)}14` }}
              >
                {lead.stage}
              </span>
              {channel === "ig" && <TouchChips lead={lead} />}
            </div>

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

            {/* Last-4 message history — context before writing, no detour to Inbox */}
            {recentMsgs.length > 0 && (
              <div className="border-t border-gray-800 pt-3 space-y-1.5">
                <p className="text-[10px] text-gray-600 uppercase tracking-wide">Recent messages</p>
                {recentMsgs.map((m) => (
                  <div key={m.id} className="flex items-start gap-2 text-xs">
                    <span className={m.direction === "inbound" ? "text-[#14B8A6]" : "text-gray-600"} title={m.direction}>
                      {m.direction === "inbound" ? "←" : "→"}
                    </span>
                    <p className="text-gray-400 leading-snug flex-1 line-clamp-2">{m.body ?? "(no text)"}</p>
                    <span className="text-gray-600 shrink-0">
                      {new Date(m.created_at).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* Opener — the hero */}
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
                  ? "Opener generating — usually ~30s. Skip ahead or regenerate."
                  : lead.research_status === "error"
                  ? "Research failed."
                  : "No opener yet."}
              </p>
              <button
                onClick={generateOpener}
                disabled={generating}
                className="w-full text-xs py-2 border border-gray-700 rounded-lg text-gray-400 hover:text-white hover:border-[#FF3A69] transition-colors disabled:opacity-50"
              >
                {generating ? "Generating…" : "Generate opener →"}
              </button>
            </div>
          )}

          {/* Scripts live one click away — the opener stays the only message
              surface on the card itself. */}
          {stageScriptCount > 0 && (
            <button
              onClick={() => setScriptsOpen(true)}
              className="w-full text-left text-xs px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg text-gray-500 hover:text-gray-300 hover:border-gray-700 transition-colors"
            >
              Scripts for this stage ({stageScriptCount}) →
            </button>
          )}

          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="Add a personal note to append (optional)..."
            rows={2}
            className="w-full bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 text-sm text-gray-300 placeholder-gray-700 resize-none outline-none focus:border-gray-600"
          />

          {/* Primary action — ONE loud button; DM Sent confirms quietly beside it
              (same hierarchy as lead-detail's quiet "See Availability" + pink "Book a Call") */}
          <div className="flex gap-3">
            <button
              onClick={primaryAction}
              className="flex-1 flex items-center justify-center gap-2 px-4 py-3 bg-[#FF3A69] hover:bg-[#e03060] text-white font-semibold rounded-lg transition-colors text-sm shadow-[0_4px_16px_rgba(255,58,105,0.3)]"
            >
              {copied ? "✓ Copied!" : channel === "ig" ? (
                <><span>Copy opener</span><span className="opacity-70">+ Open profile</span></>
              ) : (
                <><span>Copy</span><span className="opacity-70">+ Open {CHANNEL_LABELS[channel]}</span></>
              )}
            </button>
            <button
              onClick={markSent}
              disabled={!!saving || !!pendingUndo}
              className="shrink-0 px-4 py-3 bg-transparent hover:bg-gray-800 border border-gray-700 text-gray-300 font-medium rounded-lg transition-colors text-sm disabled:opacity-50"
            >
              {saving === "sent" ? "Saving..." : pendingUndo ? "Queued…" : "✓ DM Sent"}
            </button>
          </div>

          {/* Later + booking — one "later" control (snooze), one 📅 Book.
              Book is a normal secondary button (the loud pink stays on the primary above). */}
          <div className="flex items-center justify-between gap-2 rounded-lg border border-gray-800 bg-gray-900 px-3 py-2">
            <SnoozeControl
              lead={lead}
              onSnoozed={async () => {
                setNote("");
                setCopied(false);
                await refresh();
                setIdx((i) => Math.min(i, Math.max(0, queued.length - 2)));
              }}
            />
            <button
              onClick={() => setBookOpen(true)}
              className="shrink-0 rounded-lg border border-gray-700 bg-transparent px-3 py-1.5 text-xs font-medium text-gray-300 transition-colors hover:bg-gray-800"
            >
              📅 Book
            </button>
          </div>

          {/* Secondary actions */}
          <div className="flex gap-2">
            <button
              onClick={prev}
              className="flex-1 px-3 py-2 bg-gray-900 hover:bg-gray-800 border border-gray-800 text-gray-500 hover:text-gray-300 rounded-lg transition-colors text-xs font-medium"
            >
              ‹ Prev
            </button>
            <button
              onClick={markDq}
              disabled={!!saving}
              className="flex-1 px-3 py-2 bg-gray-900 hover:bg-red-950 border border-gray-800 hover:border-red-900 text-gray-500 hover:text-red-400 rounded-lg transition-colors text-xs font-medium disabled:opacity-50"
            >
              {saving === "dq" ? "Saving..." : "DQ"}
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

          {bookOpen && (
            <BookCallModal
              lead={lead}
              mode="book"
              onClose={() => setBookOpen(false)}
              onBooked={() => { refresh(); }}
            />
          )}

          {scriptsOpen && (
            <ScriptsSlideOver
              stage={lead.stage}
              channel={channel}
              leadName={lead.name ?? null}
              onClose={() => setScriptsOpen(false)}
            />
          )}
        </div>
      )}
    </div>
  );
}

// Stage-filtered scripts in a slide-over — variants for the lead's CURRENT
// stage, one click from the card without competing with the opener.
// [name]-style placeholders fill with the lead's first name; bracketed blanks
// we can't know stay visible on purpose.
function ScriptsSlideOver({
  stage,
  channel,
  leadName,
  onClose,
}: {
  stage: string;
  channel: Channel;
  leadName: string | null;
  onClose: () => void;
}) {
  const scripts = scriptsForStage(stage).filter((s) =>
    channel === "email" ? s.category === "email" : s.category !== "email",
  );
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const firstName = leadName?.trim().split(/\s+/)[0] || null;
  const fill = (t: string) => (firstName ? t.replace(/\[(first\s*)?name\]/gi, firstName) : t);

  function copy(id: string, text: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedId(id);
      setTimeout(() => setCopiedId(null), 2000);
    });
  }

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end"
      style={{ background: "rgba(3,7,18,0.6)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full max-w-md h-full overflow-y-auto bg-gray-950 border-l border-gray-800 p-5 space-y-3 animate-slide-in">
        <div className="flex items-center justify-between">
          <p className="text-sm font-semibold text-white">
            Scripts · <span style={{ color: stageColor(stage) }}>{stage}</span>
          </p>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-lg flex items-center justify-center text-gray-500 hover:text-gray-300 bg-gray-900 transition-colors"
            aria-label="Close scripts"
          >
            ✕
          </button>
        </div>

        {scripts.map((script) => {
          const text = fill(script.text);
          return (
            <div key={script.id} className="bg-gray-900 border border-gray-800 rounded-xl p-4 space-y-2">
              <div className="flex items-center justify-between gap-2">
                <p className="text-xs font-semibold text-gray-400">{script.label}</p>
                <button
                  onClick={() => copy(script.id, text)}
                  className={`shrink-0 text-xs px-3 py-1 rounded border transition-all ${
                    copiedId === script.id
                      ? "border-green-700 bg-green-900/30 text-green-400"
                      : "border-gray-700 text-gray-400 hover:border-gray-500 hover:text-gray-200"
                  }`}
                >
                  {copiedId === script.id ? "Copied!" : "Copy"}
                </button>
              </div>
              {script.subject && (
                <p className="text-xs text-gray-500">Subject: {fill(script.subject)}</p>
              )}
              <p className="text-sm text-gray-300 leading-relaxed whitespace-pre-wrap">{text}</p>
            </div>
          );
        })}

        <Link
          href={`/scripts?stage=${encodeURIComponent(stage)}`}
          className="block text-center text-xs py-2 border border-gray-800 rounded-lg text-gray-500 hover:text-gray-300 hover:border-gray-700 transition-colors"
        >
          All scripts →
        </Link>
      </div>
    </div>
  );
}
