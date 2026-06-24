"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase as getSupabase } from "@/lib/supabase";
import type { Lead } from "@/hooks/useLeads";

type UrgencyBucket = "overdue" | "today" | "upcoming" | "booked" | "archived";

const BORDER_COLORS: Record<UrgencyBucket, string> = {
  overdue: "border-l-[#d4892a]",
  today: "border-l-[#b8a245]",
  upcoming: "border-l-[#3d8b5c]",
  booked: "border-l-[#4a7abf]",
  archived: "border-l-[#4a5244]",
};

const SALES_STAGES = ["New", "Warming", "DM Sent", "Qualifying", "Call Offered", "Booked", "Closed", "DQ"];
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

export default function LeadCard({ lead, urgency }: { lead: Lead; urgency: UrgencyBucket }) {
  const [expanded, setExpanded] = useState(false);
  const [note, setNote] = useState("");
  const isSales = SALES_STAGES.includes(lead.stage);
  const stages = isSales ? SALES_STAGES : CSM_STAGES;

  async function updateStage(stage: string) {
    await getSupabase().from("leads").update({ stage, updated_at: new Date().toISOString() }).eq("id", lead.id);
  }

  async function saveNote() {
    if (!note.trim()) return;
    const existing = lead.notes ?? "";
    const ts = new Date().toLocaleString();
    await getSupabase()
      .from("leads")
      .update({ notes: `${existing}\n[${ts}] ${note}`.trim(), updated_at: new Date().toISOString() })
      .eq("id", lead.id);
    setNote("");
  }

  async function archive() {
    const stage = isSales ? "DQ" : "Churned";
    await getSupabase().from("leads").update({ stage, updated_at: new Date().toISOString() }).eq("id", lead.id);
  }

  const lastEvent = lead.ig_events?.at(-1);

  return (
    <div
      className={`bg-gray-900 border border-gray-800 border-l-4 ${BORDER_COLORS[urgency]} rounded-lg px-4 py-3 cursor-pointer`}
      onClick={() => setExpanded((e) => !e)}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-3 min-w-0">
          <span className="font-medium text-sm truncate">
            {lead.ig_username ? `@${lead.ig_username}` : lead.name}
          </span>
          {lead.source && (
            <span className="text-xs bg-gray-800 px-2 py-0.5 rounded text-gray-400">
              {lead.source}
            </span>
          )}
          {lastEvent && (
            <span className="text-xs text-gray-500 hidden sm:inline">
              {lastEvent.type} · {relativeTime(lastEvent.ts)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0">
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
          className="mt-3 space-y-3"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Stage selector */}
          <div className="flex gap-1 flex-wrap">
            {stages.map((s) => (
              <button
                key={s}
                onClick={() => updateStage(s)}
                className={`px-2 py-0.5 rounded text-xs border transition-colors ${
                  lead.stage === s
                    ? "border-blue-500 bg-blue-900/40 text-blue-300"
                    : "border-gray-700 text-gray-400 hover:border-gray-500"
                }`}
              >
                {s}
              </button>
            ))}
          </div>

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
              className="flex-1 text-xs bg-gray-800 border border-gray-700 rounded px-2 py-1 text-gray-200 outline-none focus:border-gray-500"
              onKeyDown={(e) => e.key === "Enter" && saveNote()}
            />
            <button
              onClick={saveNote}
              className="text-xs px-3 py-1 bg-gray-700 rounded hover:bg-gray-600 text-gray-200"
            >
              Save
            </button>
            <button
              onClick={archive}
              className="text-xs px-3 py-1 border border-gray-700 rounded hover:border-red-800 text-gray-500 hover:text-red-400"
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
