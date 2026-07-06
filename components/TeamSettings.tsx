"use client";
import { useState } from "react";
import { useTeam, type Invite } from "@/hooks/useTeam";
import { AESettings } from "@/components/AESettings";
import { QuicklinksSettings } from "@/components/QuicklinksSettings";
import { useToast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF3A69]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070B12]";

function roleLabel(role: string) {
  return role === "owner" ? "Owner" : role === "admin" ? "Admin" : "Rep";
}

function inviteLink(invite: Invite) {
  return `${window.location.origin}/login?invite=${invite.token}`;
}

// Live expiry chip: "6d left" (teal) → "Expires today" (amber) → "Expired" (gray).
function ExpiryChip({ expiresAt }: { expiresAt: string }) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) {
    return (
      <span className="rounded-full bg-[#1E2640] px-2 py-0.5 text-[11px] font-semibold text-[#5B6B8C]">
        Expired
      </span>
    );
  }
  if (ms < 24 * 3600 * 1000) {
    return (
      <span className="rounded-full bg-[#d4892a]/[.12] px-2 py-0.5 text-[11px] font-semibold text-[#E0B476]">
        Expires today
      </span>
    );
  }
  const days = Math.ceil(ms / (24 * 3600 * 1000));
  return (
    <span className="rounded-full bg-[#14B8A6]/10 px-2 py-0.5 text-[11px] font-semibold text-[#14B8A6]">
      {days}d left
    </span>
  );
}

export function TeamSettings() {
  const { members, invites, loading, sendInvite, resendInvite, revokeInvite } = useTeam();
  const toast = useToast();
  const [email, setEmail] = useState("");
  const [role, setRole] = useState("rep");
  const [sending, setSending] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  // Honest send feedback: the API reports whether the Gmail send worked; when
  // it didn't, the invite still exists — copy the link so it can be DM'd.
  async function copyLinkFallback(url: string | undefined, who: string) {
    if (!url) {
      toast.warning(`Email to ${who} failed — use Copy link to send it manually`);
      return;
    }
    try {
      await navigator.clipboard.writeText(url);
      toast.warning(`Email to ${who} failed — invite link copied, DM it to them`);
    } catch {
      toast.warning(`Email to ${who} failed — use Copy link to send it manually`);
    }
  }

  async function handleInvite() {
    if (!email) return;
    setSending(true);
    const result = await sendInvite(email, role);
    setSending(false);
    if (result.ok) {
      if (result.emailSent) toast.success(`Invite email sent to ${email}`);
      else await copyLinkFallback(result.inviteUrl, email);
      setEmail("");
    } else {
      toast.error(result.error ?? "Failed to send invite");
    }
  }

  async function handleCopy(invite: Invite) {
    try {
      await navigator.clipboard.writeText(inviteLink(invite));
      toast.success("Invite link copied");
    } catch {
      toast.error("Couldn't copy — clipboard is blocked");
    }
  }

  async function handleResend(invite: Invite) {
    setBusyId(invite.id);
    const result = await resendInvite(invite.id);
    setBusyId(null);
    if (result.ok) {
      if (result.emailSent) toast.success(`Invite re-sent to ${invite.email} — expires in 7 days`);
      else await copyLinkFallback(result.inviteUrl, invite.email);
    } else {
      toast.error(result.error ?? "Failed to resend invite");
    }
  }

  async function handleRevoke(invite: Invite) {
    setBusyId(invite.id);
    const result = await revokeInvite(invite.id);
    setBusyId(null);
    if (result.ok) toast.info(`Invite for ${invite.email} revoked — the link no longer works`);
    else toast.error(result.error ?? "Failed to revoke invite");
  }

  if (loading) {
    return (
      <div className="flex flex-col gap-8">
        <section>
          <Skeleton className="mb-3 h-4 w-36 bg-[#1E2640]" />
          <Skeleton className="h-9 w-full bg-[#1E2640]" />
        </section>
        <section>
          <Skeleton className="mb-3 h-4 w-24 bg-[#1E2640]" />
          <div className="flex flex-col gap-2">
            <Skeleton className="h-16 w-full bg-[#1E2640]" />
            <Skeleton className="h-16 w-full bg-[#1E2640]" />
          </div>
        </section>
      </div>
    );
  }

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
            aria-label="Teammate email address"
            className="flex-1 rounded-lg border border-[#1A2235] bg-[#0F1420] px-3 py-2 text-sm text-[#E2E8F0] outline-none focus:border-[#2A3554]"
          />
          <select
            value={role}
            onChange={(e) => setRole(e.target.value)}
            aria-label="Role for the new teammate"
            className="rounded-lg border border-[#1A2235] bg-[#0F1420] px-3 py-2 text-sm text-[#E2E8F0]"
          >
            <option value="rep">Rep</option>
            <option value="admin">Admin</option>
          </select>
          <button
            onClick={handleInvite}
            disabled={sending || !email}
            className={`rounded-lg bg-[#FF3A69] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#E02F5D] disabled:opacity-50 ${FOCUS_RING}`}
          >
            {sending ? "Sending…" : "Send Invite"}
          </button>
        </div>

        {pendingInvites.length > 0 && (
          <ul className="mt-3 flex flex-col gap-2">
            {pendingInvites.map((invite) => {
              const expired = new Date(invite.expires_at).getTime() <= Date.now();
              const busy = busyId === invite.id;
              return (
                <li
                  key={invite.id}
                  className="flex flex-wrap items-center gap-2.5 rounded-lg border border-[#1A2235] bg-[#0F1420] px-3 py-2 text-sm"
                >
                  <span className="font-medium text-[#E2E8F0]">{invite.email}</span>
                  <span className="rounded-full bg-[#3B82F6]/[.12] px-2 py-0.5 text-[11px] font-semibold text-[#60A5FA]">
                    {roleLabel(invite.role)}
                  </span>
                  <ExpiryChip expiresAt={invite.expires_at} />
                  <span className="ml-auto flex gap-1.5">
                    {!expired && (
                      <button
                        onClick={() => handleCopy(invite)}
                        disabled={busy}
                        className={`rounded-md border border-[#2A3554] bg-[#151B2E] px-2.5 py-1 text-[11.5px] font-semibold text-[#94A3B8] transition-colors hover:border-[#3B4A6E] hover:text-[#E2E8F0] disabled:opacity-50 ${FOCUS_RING}`}
                      >
                        Copy link
                      </button>
                    )}
                    <button
                      onClick={() => handleResend(invite)}
                      disabled={busy}
                      className={`rounded-md border border-[#2A3554] bg-[#151B2E] px-2.5 py-1 text-[11.5px] font-semibold text-[#94A3B8] transition-colors hover:border-[#3B4A6E] hover:text-[#E2E8F0] disabled:opacity-50 ${FOCUS_RING}`}
                    >
                      {busy ? "…" : "Resend"}
                    </button>
                    <button
                      onClick={() => handleRevoke(invite)}
                      disabled={busy}
                      className={`rounded-md border border-[#3d2230] bg-[#151B2E] px-2.5 py-1 text-[11.5px] font-semibold text-[#F0A5B8] transition-colors hover:border-[#5A3040] hover:bg-[#2A1420] disabled:opacity-50 ${FOCUS_RING}`}
                    >
                      Revoke
                    </button>
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-[#94A3B8]">Workload</h2>
        {members.length === 0 ? (
          <EmptyState
            icon="👥"
            title="No team members yet"
            description="Invite your first teammate above — they'll show up here once they accept and sign in."
          />
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
                    <span className="flex items-center gap-2 text-[#E2E8F0]">
                      {m.name}
                      <span className="rounded-full bg-[#3B82F6]/[.12] px-2 py-0.5 text-[11px] font-semibold text-[#60A5FA]">
                        {roleLabel(m.role)}
                      </span>
                    </span>
                    <span className="font-mono text-xs text-[#94A3B8]">{m.openLeads}/{m.capacity}</span>
                  </div>
                  <div
                    className="mt-2 h-1.5 rounded-full bg-[#1E2640]"
                    role="progressbar"
                    aria-valuemin={0}
                    aria-valuemax={m.capacity}
                    aria-valuenow={m.openLeads}
                    aria-label={`${m.name}: ${m.openLeads} of ${m.capacity} open leads`}
                  >
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

      <AESettings />

      <QuicklinksSettings />
    </div>
  );
}
