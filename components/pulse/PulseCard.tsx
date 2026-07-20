"use client";
// One conversation on the Pulse board. Strictly read-only: there is NO send
// button anywhere in this feature — the suggested reply is copy-paste material,
// and "Open" deep-links into the real Slack/WhatsApp thread.
import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import { Hash, MessageCircle, ExternalLink, Copy, Eye } from "lucide-react";

export type PulseConvo = {
  id: string;
  channel: "slack" | "whatsapp";
  external_id: string;
  display_name: string | null;
  client_name: string | null;
  client_notes: string | null;
  checkin_days: number;
  last_msg_at: string | null;
  last_direction: "in" | "out" | null;
  last_msg_preview: string | null;
  last_inbound_at: string | null;
  handled_at: string | null;
  ai_needs_reply: boolean | null;
  ai_waiting_on: "you" | "them" | "none" | null;
  ai_open_commitment: string | null;
  ai_summary: string | null;
  ai_suggested_reply: string | null;
  status: "red" | "amber" | "green";
  reason: string;
  hoursSinceInbound: number | null;
  seen: boolean;
  link: string | null;
};

type DetailMsg = {
  id: string;
  direction: "in" | "out";
  author: string | null;
  body: string | null;
  sent_at: string;
};

const STATUS_BORDER: Record<PulseConvo["status"], string> = {
  red: "#EF4444",
  amber: "#d4892a",
  green: "#14B8A6",
};

export function channelGlyph(channel: "slack" | "whatsapp") {
  return channel === "slack" ? (
    <Hash size={14} className="shrink-0" style={{ color: "#60A5FA" }} />
  ) : (
    <MessageCircle size={14} className="shrink-0" style={{ color: "#25D366" }} />
  );
}

function ageLabel(hours: number | null): string {
  if (hours == null) return "";
  if (hours < 1) return "<1h";
  if (hours < 48) return `${Math.round(hours)}h`;
  return `${Math.round(hours / 24)}d`;
}

function reasonLabel(c: PulseConvo): string {
  switch (c.reason) {
    case "owe_reply":
      return `owes reply · ${ageLabel(c.hoursSinceInbound)}`;
    case "commitment":
      return c.ai_open_commitment ? `you promised: ${c.ai_open_commitment}` : "you promised something";
    case "nudge":
      return "they went quiet — nudge?";
    case "checkin":
      return `no touch in ${c.checkin_days}+ days — check in`;
    case "fresh_inbound":
      return `new message · ${ageLabel(c.hoursSinceInbound)}`;
    default:
      return "all good";
  }
}

export function PulseCard({
  convo: c,
  onPatch,
}: {
  convo: PulseConvo;
  onPatch: (id: string, body: Record<string, unknown>, okMsg?: string) => void;
}) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<DetailMsg[] | null>(null);
  const [name, setName] = useState(c.client_name ?? "");
  const [notes, setNotes] = useState(c.client_notes ?? "");

  async function toggleDetail() {
    const next = !open;
    setOpen(next);
    if (next && detail === null) {
      try {
        const res = await fetch(`/api/am/conversations/${c.id}`);
        if (res.ok) {
          const { messages = [] } = await res.json();
          setDetail(messages);
        }
      } catch {}
    }
  }

  function copyReply() {
    if (!c.ai_suggested_reply) return;
    navigator.clipboard
      .writeText(c.ai_suggested_reply)
      .then(() => toast.success("Copied — paste it yourself"))
      .catch(() => toast.error("Copy failed"));
  }

  return (
    <div
      className="rounded-lg border border-l-4 px-4 py-3"
      style={{
        background: "#0F1420",
        borderColor: "#1A2235",
        borderLeftColor: STATUS_BORDER[c.status],
      }}
    >
      <div className="flex items-center gap-2">
        {channelGlyph(c.channel)}
        <button
          onClick={toggleDetail}
          className="min-w-0 truncate text-left text-sm font-semibold text-[#E2E8F0] hover:underline"
          title="Details + notes"
        >
          {c.client_name ?? c.display_name ?? c.external_id}
        </button>
        <span
          className="shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold"
          style={{
            background: `${STATUS_BORDER[c.status]}1A`,
            color: STATUS_BORDER[c.status],
          }}
        >
          {reasonLabel(c)}
        </span>
        {c.seen && c.reason === "owe_reply" && (
          <span
            className="flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10.5px] font-bold"
            style={{ background: "#EF44441A", color: "#EF4444" }}
            title="Your Slack read cursor shows you opened this after their last message"
          >
            <Eye size={11} /> seen · no reply
          </span>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-1.5">
          {c.link && (
            <a
              href={c.link}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1 rounded-md px-2 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-85"
              style={{ background: "#FF3A69" }}
            >
              <ExternalLink size={11} /> Open
            </a>
          )}
          <QuietBtn onClick={() => onPatch(c.id, { handled: true }, "Marked handled")}>
            Handled
          </QuietBtn>
          <QuietBtn onClick={() => onPatch(c.id, { snooze_days: 1 }, "Snoozed 1 day")}>1d</QuietBtn>
          <QuietBtn onClick={() => onPatch(c.id, { snooze_days: 3 }, "Snoozed 3 days")}>3d</QuietBtn>
          <QuietBtn onClick={() => onPatch(c.id, { muted: true }, "Muted")}>Mute</QuietBtn>
        </div>
      </div>

      {c.last_msg_preview && (
        <p className="mt-1.5 truncate text-xs text-[#94A3B8]">
          <span className="text-[#5B6B8C]">{c.last_direction === "out" ? "you: " : ""}</span>
          {c.last_msg_preview}
        </p>
      )}
      {c.ai_summary && <p className="mt-1 text-xs text-[#5B6B8C]">{c.ai_summary}</p>}

      {c.ai_suggested_reply && c.status !== "green" && (
        <div
          className="mt-2 flex items-start gap-2 rounded-md border px-3 py-2"
          style={{ background: "#0A0E1A", borderColor: "#1A2235" }}
        >
          <p className="min-w-0 flex-1 text-xs leading-relaxed text-[#94A3B8]">
            {c.ai_suggested_reply}
          </p>
          <button
            onClick={copyReply}
            className="flex shrink-0 items-center gap-1 rounded-md border px-2 py-1 text-[10.5px] font-semibold transition-colors hover:text-[#E2E8F0]"
            style={{ borderColor: "#1A2235", color: "#5B6B8C" }}
          >
            <Copy size={11} /> Copy
          </button>
        </div>
      )}

      {open && (
        <div className="mt-3 space-y-3 border-t pt-3" style={{ borderColor: "#1A2235" }}>
          <div className="flex gap-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Client name"
              className="w-44 rounded-md border bg-transparent px-2 py-1 text-xs text-[#E2E8F0] placeholder-[#2D3A52] outline-none focus:border-[#2A3554]"
              style={{ borderColor: "#1A2235" }}
            />
            <button
              onClick={() =>
                onPatch(c.id, { client_name: name || null, client_notes: notes || null }, "Saved")
              }
              className="rounded-md border px-2.5 py-1 text-xs font-medium transition-colors hover:text-[#E2E8F0]"
              style={{ borderColor: "#1A2235", color: "#5B6B8C" }}
            >
              Save
            </button>
          </div>
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Client context — retainer, what's in flight, what you owe them. Context here makes the AI sharper."
            rows={3}
            className="w-full rounded-md border bg-transparent px-2 py-1.5 text-xs leading-relaxed text-[#E2E8F0] placeholder-[#2D3A52] outline-none focus:border-[#2A3554]"
            style={{ borderColor: "#1A2235" }}
          />
          <div className="max-h-64 space-y-1.5 overflow-y-auto">
            {(detail ?? []).map((m) => (
              <p key={m.id} className="text-xs leading-relaxed">
                <span
                  className="font-semibold"
                  style={{ color: m.direction === "out" ? "#60A5FA" : "#94A3B8" }}
                >
                  {m.direction === "out" ? "you" : (m.author ?? "them")}:
                </span>{" "}
                <span className="text-[#94A3B8]">{m.body ?? "[no text]"}</span>
              </p>
            ))}
            {detail !== null && detail.length === 0 && (
              <p className="text-xs text-[#5B6B8C]">No messages stored yet.</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function QuietBtn({ onClick, children }: { onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className="rounded-md border px-2 py-1 text-xs font-medium transition-colors hover:text-[#E2E8F0]"
      style={{ borderColor: "#1A2235", color: "#5B6B8C" }}
    >
      {children}
    </button>
  );
}
