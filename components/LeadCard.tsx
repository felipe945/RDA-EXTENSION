"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import type { Lead } from "@/hooks/useLeads";
import { stageColor } from "@/lib/stage-colors";
import { IgHandle, isSnoozed, type LeadPlus } from "@/components/ig";
import { OwnerChip, OwnerControl } from "@/components/OwnerControl";

type UrgencyBucket = "overdue" | "today" | "upcoming" | "booked" | "archived";

const BORDER_COLORS: Record<UrgencyBucket, string> = {
  overdue: "border-l-[#d4892a]",
  today: "border-l-[#b8a245]",
  upcoming: "border-l-[#3d8b5c]",
  booked: "border-l-[#4a7abf]",
  archived: "border-l-[#4a5244]",
};

const SALES_STAGES = ["New", "Warming", "DM Sent", "Replied", "Qualifying", "Call Offered", "Booked", "Closed", "DQ"];
const CSM_STAGES = ["Active", "At Risk", "Churned"];

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

function dueLabel(iso: string): string {
  const diff = new Date(iso).getTime() - Date.now();
  if (diff < 0) {
    const h = Math.floor(-diff / 3600000);
    return h < 24 ? `${h}h overdue` : `${Math.floor(h / 24)}d overdue`;
  }
  const h = Math.floor(diff / 3600000);
  if (h < 24) return `due in ${h}h`;
  return `due in ${Math.floor(h / 24)}d`;
}

const SF_BADGE: Record<string, { label: string; bg: string; text: string }> = {
  customer:  { label: "Customer",  bg: "#14532d22", text: "#4ade80" },
  inactive:  { label: "Inactive",  bg: "#78350f22", text: "#fbbf24" },
  prospect:  { label: "Prospect",  bg: "#1e3a5f22", text: "#60a5fa" },
};

function SfBadge({ status, score }: { status: string; score: number }) {
  const cfg = SF_BADGE[status];
  if (!cfg) return null;
  return (
    <span
      className="text-xs px-1.5 py-0 rounded border shrink-0"
      style={{ background: cfg.bg, color: cfg.text, borderColor: `${cfg.text}44` }}
      title={`SF match confidence: ${score}/100`}
    >
      {cfg.label} {score >= 55 ? "✓" : score >= 25 ? "~" : "?"}
    </span>
  );
}

export default function LeadCard({ lead: leadProp, urgency, ownerLabel }: { lead: Lead; urgency: UrgencyBucket; ownerLabel?: string }) {
  const lead = leadProp as LeadPlus;
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");
  const [undoStage, setUndoStage] = useState<{ prev: string; timer: ReturnType<typeof setTimeout> } | null>(null);
  const isSales = SALES_STAGES.includes(lead.stage);
  const stages = isSales ? SALES_STAGES : CSM_STAGES;

  useEffect(() => {
    return () => { if (undoStage) clearTimeout(undoStage.timer); };
  }, [undoStage]);

  async function patchLead(fields: Record<string, unknown>) {
    await fetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: lead.id, ...fields }),
    });
  }

  async function updateStage(stage: string) {
    if (undoStage) {
      clearTimeout(undoStage.timer);
      setUndoStage(null);
    }
    const prevStage = lead.stage;
    await patchLead({ stage });
    const timer = setTimeout(() => setUndoStage(null), 3000);
    setUndoStage({ prev: prevStage, timer });
  }

  async function saveNote() {
    if (!note.trim()) return;
    const existing = lead.notes ?? "";
    const ts = new Date().toLocaleString();
    await patchLead({ notes: `${existing}\n[${ts}] ${note}`.trim() });
    setNote("");
  }

  async function archive() {
    await patchLead({ stage: isSales ? "DQ" : "Churned" });
  }

  const lastEvent = lead.ig_events?.at(-1);

  return (
    <div
      className={`card-hover border border-l-4 ${BORDER_COLORS[urgency]} rounded-xl px-4 py-3 cursor-pointer shadow-[var(--shadow-card)]`}
      style={{ background: 'linear-gradient(135deg, #0F1420, #070B12)' }}
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-7 h-7 rounded-full bg-gradient-to-br from-[#FF3A69] to-[#3B82F6] flex-shrink-0 flex items-center justify-center text-white text-[10px] font-bold">{(lead.ig_username ?? lead.name ?? '?')[0].toUpperCase()}</div>
          <span className="font-medium text-sm truncate">
            {lead.ig_username
              ? <IgHandle handle={lead.ig_username} className="text-inherit" />
              : (lead.name ?? "Unnamed")}
          </span>
          {lead.follower_count != null && (
            <span className="text-xs text-gray-500 shrink-0">
              {lead.follower_count >= 1_000_000
                ? `${(lead.follower_count / 1_000_000).toFixed(1)}M`
                : lead.follower_count >= 1_000
                ? `${Math.round(lead.follower_count / 1_000)}K`
                : String(lead.follower_count)}
            </span>
          )}
          {lead.sf_status !== "none" && lead.sf_match_reasons.length > 0 && (
            <SfBadge status={lead.sf_status} score={lead.sf_confidence_score} />
          )}
          {lead.source && (
            <span className="text-xs bg-gray-800 px-2 py-0.5 rounded text-gray-400 shrink-0">
              {lead.source}
            </span>
          )}
          {lead.stage === "Replied" && (
            <span className="text-xs font-bold text-white bg-[#8b5cf6] px-2 py-0.5 rounded-full animate-pulse-dot shrink-0">
              REPLIED
            </span>
          )}
          {lead.research_status === "complete" && lead.research_cache && (() => {
            const score = typeof lead.research_cache.fitScore === "number" ? lead.research_cache.fitScore : null;
            const stack = Array.isArray(lead.research_cache.stackDetected) ? lead.research_cache.stackDetected as string[] : [];
            const color = score !== null ? (score >= 75 ? "#22c55e" : score >= 50 ? "#f59e0b" : "#ef4444") : null;
            return (
              <div className="flex items-center gap-1.5 hidden sm:flex">
                {score !== null && (
                  <span className="text-xs font-bold tabular-nums shrink-0 w-6 text-right" style={{ color: color! }}>{score}</span>
                )}
                {score !== null && (
                  <div className="w-12 h-1 rounded-full bg-[#1E2640] overflow-hidden hidden sm:block">
                    <div className="h-full rounded-full transition-all duration-500" style={{ width: `${score}%`, background: color! }} />
                  </div>
                )}
                {stack.slice(0, 2).map(s => (
                  <span key={s} className="text-xs bg-gray-800 px-1.5 py-0 rounded text-gray-500 hidden md:inline">
                    {s}
                  </span>
                ))}
              </div>
            );
          })()}
          {lead.research_status === "pending" && (
            <span className="w-1.5 h-1.5 rounded-full bg-[#FF3A69] animate-pulse shrink-0 hidden sm:inline-block" />
          )}
          {lastEvent && (
            <span className="text-xs text-gray-500 hidden lg:inline">
              {lastEvent.type} · {relativeTime(lastEvent.ts)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
          {isSnoozed(lead) && (
            <span
              className="text-[11px] text-[#d4892a]"
              title={`Snoozed until ${new Date(lead.snoozed_until!).toLocaleDateString()}`}
            >
              zzz
            </span>
          )}
          {ownerLabel && <OwnerChip label={ownerLabel} />}
          <span className="text-xs text-gray-400">{lead.stage}</span>
          {lead.due_at && (
            <span className={`text-xs ${urgency === "overdue" ? "text-[#d4892a]" : "text-gray-500"}`}>
              {dueLabel(lead.due_at)}
            </span>
          )}
          <Link
            href={`/leads/${lead.id}`}
            onClick={(e) => e.stopPropagation()}
            className="text-xs text-gray-600 hover:text-blue-400 transition-colors"
          >
            →
          </Link>
        </div>
      </div>

      {expanded && (
        <div
          className="mt-3 space-y-3 animate-slide-in"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Stage selector */}
          <div className="flex gap-1 flex-wrap">
            {stages.map((s) => {
              const color = stageColor(s);
              const isActive = lead.stage === s;
              return (
                <button
                  key={s}
                  onClick={() => updateStage(s)}
                  className="px-2 py-0.5 rounded text-xs border transition-colors"
                  style={isActive
                    ? { borderColor: color, color, background: `${color}22` }
                    : { borderColor: "#1E2640", color: "#475569" }
                  }
                >
                  {s}
                </button>
              );
            })}
          </div>

          {/* Owner — admins get the reassign/release control, reps see the chip */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Owner:</span>
            <OwnerControl lead={lead} />
          </div>

          {/* Follow-up date setter */}
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-xs text-gray-500">Follow up:</span>
            <div className="flex gap-1">
              {[1, 3, 7, 14].map(days => (
                <button
                  key={days}
                  onClick={async () => {
                    const dueAt = new Date(Date.now() + days * 86400000).toISOString();
                    await patchLead({ due_at: dueAt });
                  }}
                  className="text-xs px-2 py-0.5 border border-gray-700 rounded text-gray-500 hover:border-gray-500 hover:text-gray-300 transition-colors"
                >
                  +{days}d
                </button>
              ))}
              <input
                type="date"
                onChange={async (e) => {
                  if (!e.target.value) return;
                  const dueAt = new Date(e.target.value).toISOString();
                  await patchLead({ due_at: dueAt });
                }}
                className="text-xs bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-500 outline-none cursor-pointer"
                title="Pick a specific date"
              />
            </div>
            {lead.due_at && (
              <button
                onClick={() => patchLead({ due_at: null })}
                className="text-xs text-gray-700 hover:text-gray-500"
                title="Clear due date"
              >
                clear
              </button>
            )}
          </div>

          {/* Stage change undo toast */}
          {undoStage && (
            <div className="flex items-center gap-2 text-xs">
              <span className="text-gray-500">Moved to {lead.stage}</span>
              <button
                onClick={async () => {
                  clearTimeout(undoStage.timer);
                  setUndoStage(null);
                  await patchLead({ stage: undoStage.prev });
                }}
                className="text-[#FF3A69] font-medium hover:underline"
              >
                Undo
              </button>
            </div>
          )}

          {/* Notes */}
          {lead.notes && (
            <pre className="text-xs text-gray-400 whitespace-pre-wrap font-sans bg-gray-800 p-2 rounded">
              {lead.notes}
            </pre>
          )}

          <div className="flex gap-2">
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Add note..."
              className="flex-1 text-xs border rounded px-2 py-1 text-gray-200 outline-none transition-colors" style={{ background: 'var(--surface-2)', borderColor: 'var(--border)', color: 'var(--t1)' }} onFocus={(e)=>{e.currentTarget.style.borderColor='var(--border-bright)'}} onBlur={(e)=>{e.currentTarget.style.borderColor='var(--border)'}}
              onKeyDown={(e) => e.key === "Enter" && saveNote()}
            />
            <button
              onClick={saveNote}
              className="text-xs px-3 py-1 rounded text-gray-200 transition-colors" style={{ background: 'var(--surface-3)' }}
            >
              Save
            </button>
            <button
              onClick={archive}
              className="text-xs px-3 py-1 border rounded text-gray-500 hover:text-red-400 hover:border-red-900 transition-colors" style={{ borderColor: 'var(--border)' }}
            >
              Archive
            </button>
          </div>

          {/* IG event log */}
          {lead.ig_events?.length > 0 && (
            <div className="space-y-1">
              <p className="text-xs text-gray-600 uppercase tracking-wide">IG Activity</p>
              {lead.ig_events.map((ev, i) => (
                <div key={i} className="text-xs text-gray-500 flex gap-2">
                  <span className="text-gray-600">{new Date(ev.ts).toLocaleDateString()}</span>
                  <span>{ev.type}</span>
                  {ev.postUrl && (
                    <a
                      href={ev.postUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-blue-500 hover:underline truncate"
                      onClick={(e) => e.stopPropagation()}
                    >
                      post
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
