"use client";
// Server-persisted snooze (SPLIT-T2, contract C4) — replaces the extension's
// old localStorage-only snooze so it shows identically on both surfaces.
import { useState } from "react";
import { useToast } from "@/components/ui/toast";
import type { LeadPlus } from "@/components/ig";
import { isSnoozed } from "@/components/ig";

const OPTIONS: { label: string; days: number }[] = [
  { label: "+1d", days: 1 },
  { label: "+3d", days: 3 },
  { label: "+1w", days: 7 },
];

export function SnoozeControl({ lead, onSnoozed }: { lead: LeadPlus; onSnoozed?: () => void }) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  async function snooze(until: string | null) {
    setBusy(true);
    try {
      const res = await fetch(`/api/leads/${lead.id}/snooze`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ until }),
      });
      if (!res.ok) {
        const data = (await res.json().catch(() => ({}))) as { error?: string };
        toast.error(data.error ?? `Snooze failed (HTTP ${res.status})`);
      } else {
        toast.success(
          until
            ? `Snoozed until ${new Date(until).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
            : "Snooze cleared",
        );
        onSnoozed?.();
      }
    } catch {
      toast.error("Snooze failed — network error");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-1.5 flex-wrap" onClick={(e) => e.stopPropagation()}>
      <span className="text-xs text-gray-500">Snooze:</span>
      {OPTIONS.map(({ label, days }) => (
        <button
          key={label}
          disabled={busy}
          onClick={() => snooze(new Date(Date.now() + days * 86400000).toISOString())}
          className="rounded border border-gray-700 px-2 py-0.5 text-xs text-gray-500 transition-colors hover:border-gray-500 hover:text-gray-300 disabled:opacity-50"
        >
          {label}
        </button>
      ))}
      {isSnoozed(lead) && (
        <span className="inline-flex items-center gap-1 text-xs text-[#d4892a]">
          zzz until {new Date(lead.snoozed_until!).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
          <button
            disabled={busy}
            onClick={() => snooze(null)}
            className="text-gray-600 hover:text-gray-400"
            title="Clear snooze"
          >
            ✕
          </button>
        </span>
      )}
    </span>
  );
}
