"use client";
// Admin-only per-rep attribution panel (SPLIT-T2, contract C6).
// GET /api/stats/reps → [{ rep_id, name, owned, dmSent, replied, booked }].
// Degrades to nothing while T1's endpoint isn't live (or for reps' 403).
import { useEffect, useState } from "react";

type RepStats = {
  rep_id: string;
  name: string;
  owned?: number;
  dmSent?: number;
  replied?: number;
  booked?: number;
};

const COLUMNS: { key: keyof RepStats; label: string }[] = [
  { key: "owned",   label: "Owned" },
  { key: "dmSent",  label: "DMs Sent" },
  { key: "replied", label: "Replied" },
  { key: "booked",  label: "Booked" },
];

export function RepStatsPanel() {
  const [reps, setReps] = useState<RepStats[] | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/stats/reps")
      .then((res) => (res.ok ? res.json() : null))
      .then((data: RepStats[] | { reps?: RepStats[] } | null) => {
        if (cancelled || !data) return;
        setReps(Array.isArray(data) ? data : (data.reps ?? null));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  if (!reps || reps.length === 0) return null;

  return (
    <div className="rounded-xl border px-4 py-3" style={{ background: "#0F1420", borderColor: "#1A2235" }}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-widest text-[#5B6B8C]">Rep performance</p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-[10.5px] uppercase tracking-wide text-[#5B6B8C]">
              <th className="py-1 pr-4 font-semibold">Rep</th>
              {COLUMNS.map((c) => (
                <th key={c.key} className="py-1 pr-4 text-right font-semibold">{c.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {reps.map((r) => (
              <tr key={r.rep_id} className="border-t border-[#1A2235]">
                <td className="py-1.5 pr-4 text-[#E2E8F0]">{r.name}</td>
                {COLUMNS.map((c) => (
                  <td key={c.key} className="py-1.5 pr-4 text-right font-mono text-xs text-[#94A3B8]">
                    {(r[c.key] as number | undefined) ?? 0}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
