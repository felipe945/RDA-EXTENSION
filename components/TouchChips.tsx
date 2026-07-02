"use client";
// Read-only mirror of the extension's two-touch chips (outreach_channels is
// written by sidepanel's FB / Pers. buttons and the DM-Sent flow). Shared by
// LeadDetailPanel and the outreach queue card so both surfaces read the same.
import type { LeadPlus } from "@/components/ig";

const IG_TOUCHES = [
  { key: "ig_fanbasis", label: "FanBasis IG" },
  { key: "ig_personal", label: "Personal IG" },
];

type TouchEntry = { sent?: boolean; sentAt?: number } | undefined;

export function TouchChips({ lead }: { lead: LeadPlus }) {
  const chs = (lead.outreach_channels ?? {}) as Record<string, TouchEntry>;
  const linkedinSent = chs.linkedin?.sent;

  function chip(label: string, entry?: TouchEntry) {
    const done = !!entry?.sent;
    const when =
      done && entry?.sentAt
        ? ` · ${new Date(entry.sentAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}`
        : "";
    return (
      <span
        key={label}
        className={`rounded-full border px-2 py-0.5 text-[11px] font-medium ${
          done
            ? "border-[#14B8A6]/40 bg-[#14B8A6]/10 text-[#14B8A6]"
            : "border-[#1A2235] text-[#5B6B8C]"
        }`}
      >
        {done ? "✓" : "○"} {label}
        {when}
      </span>
    );
  }

  return (
    <div className="flex gap-1.5 flex-wrap">
      {IG_TOUCHES.map(({ key, label }) => chip(label, chs[key]))}
      {linkedinSent && chip("LinkedIn", chs.linkedin)}
    </div>
  );
}
