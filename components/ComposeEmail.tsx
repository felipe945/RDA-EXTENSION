"use client";

import { useState } from "react";
import { useSession, signIn } from "next-auth/react";

interface Props {
  leadId: string;
  to: string;
  defaultSubject?: string;
  defaultBody?: string;
  onSent?: () => void;
}

export default function ComposeEmail({ leadId, to, defaultSubject = "", defaultBody = "", onSent }: Props) {
  const { data: session, status } = useSession();
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(defaultSubject);
  const [body, setBody] = useState(defaultBody);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState<"sent" | "error" | null>(null);

  if (status === "loading") return null;

  // Not signed in — show connect button
  if (!session?.access_token || session.error) {
    return (
      <button
        onClick={() => signIn("google")}
        className="flex items-center gap-2 px-3 py-2 text-xs border border-gray-700 rounded-lg text-gray-400 hover:text-white hover:border-gray-500 transition-colors w-full"
      >
        <span>✉</span>
        <span>Connect Gmail to send email</span>
      </button>
    );
  }

  async function send() {
    if (!subject.trim() || !body.trim()) return;
    setSending(true);
    setResult(null);
    try {
      const res = await fetch("/api/gmail/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to, subject, body, leadId }),
      });
      if (res.ok) {
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

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="flex items-center gap-2 px-3 py-2 text-xs border border-gray-700 rounded-lg text-gray-400 hover:text-white hover:border-gray-500 transition-colors w-full"
      >
        <span>✉</span>
        <span>Send email to {to}</span>
      </button>
    );
  }

  return (
    <div className="border border-gray-700 rounded-lg overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-800 border-b border-gray-700">
        <span className="text-xs font-medium text-gray-300">To: {to}</span>
        <button onClick={() => setOpen(false)} className="text-gray-500 hover:text-gray-300 text-xs">✕</button>
      </div>

      {/* Subject */}
      <input
        value={subject}
        onChange={e => setSubject(e.target.value)}
        placeholder="Subject"
        className="w-full bg-gray-900 px-3 py-2 text-sm text-gray-200 border-b border-gray-700 outline-none placeholder:text-gray-600"
      />

      {/* Body */}
      <textarea
        value={body}
        onChange={e => setBody(e.target.value)}
        placeholder="Write your message..."
        rows={6}
        className="w-full bg-gray-900 px-3 py-2 text-sm text-gray-200 outline-none placeholder:text-gray-600 resize-none leading-relaxed"
      />

      {/* Footer */}
      <div className="flex items-center justify-between px-3 py-2 bg-gray-900 border-t border-gray-700">
        {result === "sent" && <span className="text-xs text-green-400">Sent ✓</span>}
        {result === "error" && <span className="text-xs text-red-400">Failed — try again</span>}
        {!result && <span className="text-xs text-gray-600">{body.length} chars</span>}
        <button
          onClick={send}
          disabled={sending || !subject.trim() || !body.trim()}
          className="px-4 py-1.5 bg-[#ff0076] hover:bg-[#e0006a] text-white text-xs font-semibold rounded-md transition-colors disabled:opacity-40"
        >
          {sending ? "Sending…" : "Send"}
        </button>
      </div>
    </div>
  );
}
