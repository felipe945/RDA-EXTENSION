"use client";

import { useState } from "react";
import type { Lead } from "@/hooks/useLeads";

type Touchpoint = {
  id: string;
  channel: string;
  result: string;
  note: string | null;
  tried_at: string;
};

type Channel = { key: string; label: string; icon: string; ring: string };

const CHANNELS: Channel[] = [
  { key: "ig_dm",       label: "IG DM",       icon: "📷", ring: "border-pink-700 text-pink-300 bg-pink-950/30" },
  { key: "ig_fanbasis", label: "IG FanBasis",  icon: "📸", ring: "border-pink-700 text-pink-300 bg-pink-950/30" },
  { key: "ig_personal", label: "IG Personal",  icon: "📷", ring: "border-purple-700 text-purple-300 bg-purple-950/30" },
  { key: "email",       label: "Email",        icon: "✉",  ring: "border-blue-700 text-blue-300 bg-blue-950/30" },
  { key: "sms",         label: "SMS",          icon: "💬", ring: "border-green-700 text-green-300 bg-green-950/30" },
  { key: "linkedin",    label: "LinkedIn",     icon: "💼", ring: "border-sky-700 text-sky-300 bg-sky-950/30" },
  { key: "youtube",     label: "YouTube",      icon: "▶",  ring: "border-red-700 text-red-300 bg-red-950/30" },
  { key: "call",        label: "Call",         icon: "📞", ring: "border-yellow-700 text-yellow-300 bg-yellow-950/30" },
  { key: "loom",        label: "Loom",         icon: "🎥", ring: "border-purple-700 text-purple-300 bg-purple-950/30" },
];

const RESULTS = [
  { key: "sent",     label: "Sent",     dot: "bg-blue-500" },
  { key: "no_reply", label: "No Reply", dot: "bg-gray-500" },
  { key: "replied",  label: "Replied",  dot: "bg-green-500" },
  { key: "booked",   label: "Booked",   dot: "bg-[#ff0076]" },
  { key: "bounced",  label: "Bounced",  dot: "bg-red-500" },
];

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function TouchpointsTab({ lead }: { lead: Lead }) {
  const [saving, setSaving] = useState(false);
  const [addingNote, setAddingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const touchpoints = (lead.outreach_log ?? []) as Touchpoint[];
  const sorted = [...touchpoints].sort(
    (a, b) => new Date(b.tried_at).getTime() - new Date(a.tried_at).getTime()
  );

  const tried    = new Set(touchpoints.map((t) => t.channel));
  const untried  = CHANNELS.filter((c) => !tried.has(c.key));
  const triedChs = CHANNELS.filter((c) => tried.has(c.key));

  async function log(channel: string, result = "sent", note?: string) {
    setSaving(true);
    await fetch(`/api/leads/${lead.id}/touchpoints`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, result, note: note || undefined }),
    });
    setSaving(false);
    setAddingNote(null);
    setNoteText("");
  }

  async function updateResult(touchpointId: string, result: string) {
    await fetch(`/api/leads/${lead.id}/touchpoints`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ touchpointId, result }),
    });
  }

  return (
    <div className="space-y-5">
      {/* Channel coverage bar */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Coverage</p>
          <span className="text-xs text-gray-600">{tried.size}/{CHANNELS.length} channels</span>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {CHANNELS.map((ch) => {
            const hit = tried.has(ch.key);
            const last = [...touchpoints].reverse().find((t) => t.channel === ch.key);
            const dot  = last ? RESULTS.find((r) => r.key === last.result)?.dot : undefined;
            return (
              <div
                key={ch.key}
                className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs ${
                  hit ? ch.ring : "border-gray-800 text-gray-600"
                }`}
              >
                <span>{ch.icon}</span>
                <span>{ch.label}</span>
                {hit && dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Log untried channel */}
      {untried.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Log outreach</p>
          <div className="flex gap-1.5 flex-wrap">
            {untried.map((ch) =>
              addingNote === ch.key ? (
                <div
                  key={ch.key}
                  className="flex items-center gap-1.5 bg-gray-900 border border-gray-600 rounded-lg px-2.5 py-1.5"
                >
                  <span>{ch.icon}</span>
                  <input
                    autoFocus
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="note (optional)"
                    className="bg-transparent text-xs text-gray-200 outline-none w-28 placeholder:text-gray-600"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") log(ch.key, "sent", noteText);
                      if (e.key === "Escape") setAddingNote(null);
                    }}
                  />
                  <button
                    onClick={() => log(ch.key, "sent", noteText)}
                    disabled={saving}
                    className="text-xs text-[#ff0076] hover:text-[#e0006a] font-medium"
                  >
                    Log
                  </button>
                </div>
              ) : (
                <button
                  key={ch.key}
                  onClick={() => { setAddingNote(ch.key); setNoteText(""); }}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-700 rounded-lg text-xs text-gray-400 hover:border-gray-500 hover:text-gray-200 transition-colors disabled:opacity-40"
                >
                  <span>{ch.icon}</span>
                  <span>{ch.label}</span>
                </button>
              )
            )}
          </div>
        </div>
      )}

      {/* Re-try a tried channel */}
      {triedChs.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Log another attempt</p>
          <div className="flex gap-1.5 flex-wrap">
            {triedChs.map((ch) => (
              <button
                key={ch.key}
                onClick={() => log(ch.key)}
                disabled={saving}
                className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs transition-colors disabled:opacity-40 ${ch.ring}`}
              >
                <span>{ch.icon}</span>
                <span>+ {ch.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Timeline */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
          History ({touchpoints.length})
        </p>
        {sorted.length === 0 ? (
          <p className="text-sm text-gray-600 py-6 text-center">
            No outreach logged yet — tap a channel above.
          </p>
        ) : (
          <div className="space-y-0">
            {sorted.map((tp) => {
              const ch = CHANNELS.find((c) => c.key === tp.channel);
              return (
                <div key={tp.id} className="flex items-center gap-3 py-2.5 border-b border-gray-800/60">
                  <span className="text-sm w-5 text-center shrink-0">{ch?.icon ?? "?"}</span>
                  <span className="text-xs text-gray-300 w-16 shrink-0">{ch?.label ?? tp.channel}</span>
                  <select
                    defaultValue={tp.result}
                    onChange={(e) => updateResult(tp.id, e.target.value)}
                    className="text-xs bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-300 outline-none cursor-pointer"
                  >
                    {RESULTS.map((r) => (
                      <option key={r.key} value={r.key}>{r.label}</option>
                    ))}
                  </select>
                  {tp.note && (
                    <span className="text-xs text-gray-600 flex-1 truncate italic">"{tp.note}"</span>
                  )}
                  <span className="text-xs text-gray-600 shrink-0 ml-auto">{relTime(tp.tried_at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
