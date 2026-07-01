"use client";
import { useState } from "react";
import { useTeam } from "@/hooks/useTeam";
import { useToast } from "@/components/ui/toast";

export function TeamSettings() {
  const { members, invites, loading, sendInvite } = useTeam();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("rep");
  const [sending, setSending] = useState(false);

  async function handleInvite() {
    if (!email) return;
    setSending(true);
    const result = await sendInvite(email, role);
    setSending(false);
    if (result.ok) {
      toast.success(`Invite sent to ${email}`);
      if (result.inviteUrl) {
        try {
          await navigator.clipboard.writeText(result.inviteUrl);
          toast.info("Invite link copied — send it directly if email delivery fails");
        } catch {
          // clipboard blocked (e.g. non-HTTPS) — the toast above already confirmed the invite
        }
      }
      setEmail("");
    } else {
      toast.error(result.error ?? "Failed to send invite");
    }
  }

  if (loading) return <div className="text-sm text-[#94A3B8]">Loading team…</div>;

  const pendingInvites = invites.filter((i) => !i.accepted_at);

  return (
    <div className="flex flex-col gap-8">
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#94A3B8]">Invite a teammate</h2>
        <div className="flex gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleInvite()}
            placeholder="teammate@fanbasis.com"
            type="email"
            className="flex-1 rounded-lg border border-[#1A2235] bg-[#0F1420] px-3 py-2 text-sm text-[#E2E8F0] outline-none focus:border-[#2A3554]"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            className="rounded-lg border border-[#1A2235] bg-[#0F1420] px-3 py-2 text-sm text-[#E2E8F0]"
          >
            <option value="rep">Rep</option>
            <option value="admin">Admin</option>
          </select>
          <button
            onClick={handleInvite}
            disabled={sending || !email}
            className="rounded-lg bg-[#FF3A69] px-4 py-2 text-sm font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {sending ? "Sending…" : "Send Invite"}
          </button>
        </div>
        {pendingInvites.length > 0 && (
          <ul className="mt-3 flex flex-col gap-1 text-xs text-[#94A3B8]">
            {pendingInvites.map((i) => (
              <li key={i.id}>{i.email} — pending ({i.role})</li>
            ))}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#94A3B8]">Workload</h2>
        {members.length === 0 ? (
          <p className="text-sm text-[#5B6B8C]">No team members yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {members.map((m) => {
              const pct = m.capacity > 0
                ? Math.min(100, Math.round((m.openLeads / m.capacity) * 100))
                : 0;
              const over = m.capacity > 0 && m.openLeads > m.capacity;
              return (
                <div key={m.userId} className="rounded-lg border border-[#1A2235] bg-[#0F1420] p-3">
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-[#E2E8F0]">
                      {m.name} <span className="text-[#5B6B8C]">· {m.role}</span>
                    </span>
                    <span className="font-mono text-xs text-[#94A3B8]">{m.openLeads}/{m.capacity}</span>
                  </div>
                  <div className="mt-2 h-1.5 rounded-full bg-[#1E2640]">
                    <div
                      className="h-1.5 rounded-full transition-all"
                      style={{ width: `${pct}%`, background: over ? "#FF3A69" : "#14B8A6" }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    </div>
  );
}
