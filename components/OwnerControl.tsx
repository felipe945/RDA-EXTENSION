"use client";
// Admin-only reassign / release control (SPLIT-T2, contract C3).
// Hybrid ownership: owner_id null = cold pool; DM-Sent auto-claims (server-side
// C2) — this control is the admin override for stalled/hoarded leads.
// The show/hide here is cosmetic; the real guard is the server's 403.
import { useState } from "react";
import { useSession } from "next-auth/react";
import { useTeam } from "@/hooks/useTeam";
import { canManageTeam } from "@/lib/permissions";
import { useToast } from "@/components/ui/toast";
import type { LeadPlus } from "@/components/ig";

export function ownerLabel(lead: LeadPlus, myUserId?: string, nameLookup?: (id: string) => string | undefined): string {
  if (!lead.owner_id) return "Unclaimed";
  if (myUserId && lead.owner_id === myUserId) return "Yours";
  return lead.owner_name ?? nameLookup?.(lead.owner_id) ?? "Claimed";
}

export function OwnerChip({ label }: { label: string }) {
  const style =
    label === "Yours"
      ? "bg-[#14B8A6]/10 text-[#14B8A6]"
      : label === "Unclaimed"
        ? "bg-[#1E2640] text-[#5B6B8C]"
        : "bg-[#3B82F6]/[.12] text-[#60A5FA]";
  return (
    <span className={`rounded-full px-2 py-0.5 text-[11px] font-semibold shrink-0 ${style}`}>
      {label}
    </span>
  );
}

export function OwnerControl({ lead, onChanged }: { lead: LeadPlus; onChanged?: () => void }) {
  const { data: session } = useSession();
  const { members } = useTeam();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const label = ownerLabel(lead, session?.userId, (id) => members.find((m) => m.userId === id)?.name);

  // Reps see the label only — reassign is admin's anti-hoarding tool.
  if (!canManageTeam(session?.role)) return <OwnerChip label={label} />;

  async function reassign(ownerId: string) {
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/assign`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ owner_id: ownerId || null }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? `Reassign failed (HTTP ${res.status})`);
      } else {
        toast.success(ownerId ? "Lead reassigned" : "Released to the pool");
        onChanged?.();
      }
    } catch {
      toast.error("Reassign failed — network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5" onClick={(e) => e.stopPropagation()}>
      <OwnerChip label={label} />
      <select
        value={lead.owner_id ?? ""}
        onChange={(e) => reassign(e.target.value)}
        disabled={busy}
        aria-label="Reassign lead owner"
        className="rounded border border-[#1A2235] bg-[#0F1420] px-1.5 py-0.5 text-xs text-[#94A3B8] outline-none focus:border-[#2A3554] disabled:opacity-50"
      >
        <option value="">↺ Release to pool</option>
        {members.map((m) => (
          <option key={m.userId} value={m.userId}>{m.name}</option>
        ))}
      </select>
    </span>
  );
}
