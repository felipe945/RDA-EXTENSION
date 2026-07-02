"use client";
// IG link helpers + the clickable-handle affordance (SPLIT-T2, contract C7).
// The canonical profile URL lives here for the dashboard; the extension keeps
// its own copy (separate runtime).
import { useState } from "react";
import type { Lead } from "@/lib/types";

// Fields SPLIT-T1's C1 adds to /api/leads rows. lib/types.ts is T1's file —
// this intersection keeps T2 compiling whether or not they've landed there yet.
export type LeadPlus = Lead & {
  snoozed_until?: string | null;
  owner_name?: string | null;
  rep_id?: string | null;
};

export function igProfileUrl(handle: string): string {
  return `https://www.instagram.com/${handle.replace(/^@/, "")}/`;
}

export function igDmUrl(handle: string): string {
  return `https://www.instagram.com/direct/t/${handle.replace(/^@/, "")}`;
}

export function isSnoozed(lead: LeadPlus): boolean {
  return !!lead.snoozed_until && new Date(lead.snoozed_until).getTime() > Date.now();
}

// @handle as a profile link + a copy-handle button. Stops propagation so it
// can sit inside clickable cards.
export function IgHandle({ handle, className }: { handle: string; className?: string }) {
  const [copied, setCopied] = useState(false);

  function copy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    navigator.clipboard.writeText(`@${handle.replace(/^@/, "")}`).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <span className="inline-flex items-center gap-1 min-w-0">
      <a
        href={igProfileUrl(handle)}
        target="_blank"
        rel="noreferrer"
        onClick={(e) => e.stopPropagation()}
        className={`truncate hover:underline decoration-[#FF3A69]/60 underline-offset-2 ${className ?? ""}`}
        title={`Open instagram.com/${handle.replace(/^@/, "")}`}
      >
        @{handle.replace(/^@/, "")}
      </a>
      <button
        onClick={copy}
        title="Copy @handle"
        aria-label={`Copy @${handle.replace(/^@/, "")}`}
        className="shrink-0 rounded px-1 text-xs text-gray-600 transition-colors hover:text-gray-300 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[#FF3A69]/60"
      >
        {copied ? "✓" : "⧉"}
      </button>
    </span>
  );
}
