"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useMode } from "@/components/ModeProvider";

type Message = {
  id: string;
  created_at: string;
  lead_id: string | null;
  channel: "ig" | "email" | "linkedin";
  direction: "inbound" | "outbound";
  body: string;
  read: boolean;
  lead_name?: string;
  ig_username?: string;
};

const CHANNEL_LABELS: Record<string, string> = {
  ig: "Instagram",
  email: "Email",
  linkedin: "LinkedIn",
};

const CHANNEL_COLORS: Record<string, string> = {
  ig: "text-pink-400 bg-pink-900/20 border-pink-800",
  email: "text-blue-400 bg-blue-900/20 border-blue-800",
  linkedin: "text-sky-400 bg-sky-900/20 border-sky-800",
};

function relTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

export default function InboxPage() {
  const { mode } = useMode();
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState<"all" | "unread">("unread");
  const [direction, setDirection] = useState<"inbound" | "outbound" | "all">("inbound");

  useEffect(() => {
    // data-C1: reads go through /api/messages (org-scoped server-side) — the
    // browser anon key can no longer SELECT messages (migration 020). Realtime
    // went with it (anon can't subscribe); a 30s poll keeps replies flowing in.
    async function load() {
      const dir = direction !== "all" ? `&direction=${direction}` : "";
      const res = await fetch(`/api/messages?mode=${mode}${dir}&limit=100`);
      if (!res.ok) {
        setMessages([]);
        setLoading(false);
        return;
      }
      const { messages: data } = await res.json() as { messages: Record<string, unknown>[] };
      const flat = (data ?? []).map((m: Record<string, unknown>) => {
        const lead = m.leads as { name?: string; ig_username?: string } | null;
        return {
          ...(m as Omit<Message, "lead_name" | "ig_username">),
          lead_name: lead?.name ?? null,
          ig_username: lead?.ig_username ?? null,
        } as Message;
      });
      setMessages(flat);
      setLoading(false);
    }
    load();

    const poll = setInterval(load, 30_000);
    return () => { clearInterval(poll); };
  }, [mode, direction]);

  async function patchRead(ids: string[]) {
    await fetch("/api/messages", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ids }),
    });
  }

  async function markRead(id: string) {
    await patchRead([id]);
    setMessages((prev) => prev.map((m) => (m.id === id ? { ...m, read: true } : m)));
  }

  async function markAllRead() {
    const unreadIds = messages.filter((m) => !m.read).map((m) => m.id);
    if (!unreadIds.length) return;
    await patchRead(unreadIds);
    setMessages((prev) => prev.map((m) => ({ ...m, read: true })));
  }

  const visible = filter === "unread" ? messages.filter((m) => !m.read) : messages;
  const unreadCount = messages.filter((m) => !m.read).length;

  return (
    <div className="max-w-2xl mx-auto space-y-5">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h1 className="text-base font-semibold">
          Inbox
          {unreadCount > 0 && (
            <span className="ml-2 text-xs bg-blue-600 text-white px-1.5 py-0.5 rounded-full">
              {unreadCount}
            </span>
          )}
        </h1>
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex gap-1">
            {(["inbound", "outbound", "all"] as const).map((d) => (
              <button
                key={d}
                onClick={() => setDirection(d)}
                className={`px-3 py-1 rounded-md text-xs transition-colors ${
                  direction === d ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {d === "inbound" ? "Received" : d === "outbound" ? "Sent" : "All"}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {(["unread", "all"] as const).map((f) => (
              <button
                key={f}
                onClick={() => setFilter(f)}
                className={`px-3 py-1 rounded-md text-xs transition-colors ${
                  filter === f ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"
                }`}
              >
                {f === "unread" ? "Unread" : "All"}
              </button>
            ))}
          </div>
          {unreadCount > 0 && (
            <button
              onClick={markAllRead}
              className="text-xs text-gray-500 hover:text-gray-300 border border-gray-800 rounded px-2 py-1 transition-colors"
            >
              Mark all read ({unreadCount})
            </button>
          )}
        </div>
      </div>

      {loading && (
        <div className="text-sm text-gray-600 py-12 text-center">Loading messages...</div>
      )}

      {!loading && visible.length === 0 && (
        <div className="text-sm text-gray-600 py-16 text-center space-y-2">
          <p>{filter === "unread" ? "No unread messages." : "No messages yet."}</p>
          {filter === "unread" && messages.length > 0 && (
            <button onClick={() => setFilter("all")} className="text-blue-500 hover:underline text-xs">
              View all {messages.length}
            </button>
          )}
          {messages.length === 0 && (
            <p className="text-gray-700 text-xs">
              Replies land here when detection is live — for now, work Replied leads from the Dashboard.
            </p>
          )}
        </div>
      )}

      <div className="space-y-2">
        {visible.map((msg) => {
          const sender = msg.ig_username ? `@${msg.ig_username}` : (msg.lead_name ?? "Unknown");
          return (
            <div
              key={msg.id}
              className={`bg-gray-900 border border-gray-800 rounded-lg px-4 py-3 space-y-2 ${
                !msg.read ? "border-l-2 border-l-blue-500" : ""
              }`}
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2 min-w-0">
                  {msg.lead_id ? (
                    <Link
                      href={`/leads/${msg.lead_id}`}
                      className="text-sm font-medium hover:text-blue-400 truncate"
                    >
                      {sender}
                    </Link>
                  ) : (
                    <span className="text-sm font-medium text-gray-400 truncate">{sender}</span>
                  )}
                  <span
                    className={`text-xs px-1.5 py-0.5 rounded border ${
                      CHANNEL_COLORS[msg.channel] ?? "text-gray-400 bg-gray-800 border-gray-700"
                    }`}
                  >
                    {CHANNEL_LABELS[msg.channel] ?? msg.channel}
                  </span>
                </div>
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-xs text-gray-600">{relTime(msg.created_at)}</span>
                  {!msg.read && (
                    <button
                      onClick={() => markRead(msg.id)}
                      className="text-xs text-gray-500 hover:text-gray-300"
                    >
                      Mark read
                    </button>
                  )}
                </div>
              </div>
              <p className="text-sm text-gray-300 leading-relaxed line-clamp-3">{msg.body}</p>
              {msg.lead_id && (
                <Link
                  href={`/leads/${msg.lead_id}`}
                  className="text-xs text-blue-500 hover:underline"
                >
                  View lead →
                </Link>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
