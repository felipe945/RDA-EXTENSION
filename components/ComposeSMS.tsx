"use client";

import { useState } from "react";

interface Props {
  leadId: string;
  to: string;
  defaultMessage?: string;
  onSent?: () => void;
}

export default function ComposeSMS({ leadId, to, defaultMessage = "", onSent }: Props) {
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState(defaultMessage);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<"sent" | "error" | "unconfigured" | null>(null);

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-2 text-xs border border-gray-700 rounded-lg text-gray-400 hover:text-white hover:border-gray-500 transition-colors w-full"
      >
        <span>💬</span>
        <span>Send SMS to {to}</span>
      </button>
    );
  }

  async function send() {
    if (!message.trim()) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/sms/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, message, leadId }),
      });
      if (res.status === 503) {
        setResult("unconfigured");
      } else if (res.ok) {
        setResult("sent");
        setTimeout(() => { setOpen(false); setResult(null); onSent?.(); }, 1500);
      } else {
        setResult("error");
      }
    } catch {
      setResult("error");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
        <span className="text-xs font-medium text-gray-300">💬 SMS to {to}</span>
        <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
      </div>
      <textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        placeholder="Write your message..."
        rows={4}
        className="w-full bg-gray-900 px-3 py-2 text-sm text-gray-200 outline-none placeholder:text-gray-600 resize-none leading-relaxed"
      />
      <div className="flex items-center justify-between px-3 py-2 bg-gray-900 border-t border-gray-700">
        {result === "sent"         && <span className="text-xs text-green-400">Sent ✓</span>}
        {result === "error"        && <span className="text-xs text-red-400">Failed — try again</span>}
        {result === "unconfigured" && <span className="text-xs text-amber-400">Add SENDBLUE_API_KEY + SENDBLUE_API_SECRET to .env.local</span>}
        {!result && <span className="text-xs text-gray-600">{message.length} chars</span>}
        <button
          onClick={send}
          disabled={sending || !message.trim()}
          className="px-4 py-1.5 bg-[#ff0076] hover:bg-[#e0006a] text-white text-xs font-semibold rounded-md transition-colors disabled:opacity-40"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
