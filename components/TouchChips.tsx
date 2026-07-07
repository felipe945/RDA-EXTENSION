"use client";
// Read-only mirror of the split two-touch model (Contract TOUCH, written by
// /api/leads/touch — dashboard queue + extension):
//   ig_fanbasis    — team-shared FanBasis touch, ONE teal chip, shows who sent
//                    it (byName) — the only touch that means "contacted".
//   ig_personal_by — per-rep personal touches, one BLUE chip per rep who sent.
//   ig_personal    — legacy aggregate (server-derived); rendered dimmed as
//                    "unattributed" only when old data has no per-rep entries.
// Shared by LeadDetailPanel and the outreach queue card so both surfaces read
// the same.
import type { LeadPlus } from "@/components/ig";

type FanbasisTouch =
  | { sent?: boolean; sentAt?: number; byId?: string; byName?: string | null }
  | undefined;
type LegacyTouch = { sent?: boolean; sentAt?: number } | undefined;
type PersonalTouch = {
  sent?: boolean;
  sentAt?: number;
  name?: string | null;
  handle?: string | null;
};

const CHIP_BASE = "rounded-full border px-2 py-0.5 text-[11px] font-medium";
const TEAL_DONE = `${CHIP_BASE} border-[#14B8A6]/40 bg-[#14B8A6]/10 text-[#14B8A6]`;
const GRAY_PENDING = `${CHIP_BASE} border-[#1A2235] text-[#5B6B8C]`;
const BLUE_DONE = `${CHIP_BASE} border-[#3B82F6]/40 bg-[#3B82F6]/10 text-[#3B82F6]`;
const TEAL_DIMMED = `${CHIP_BASE} border-[#14B8A6]/20 bg-[#14B8A6]/5 text-[#14B8A6]/50`;

function fmtDate(ts?: number): string {
  return ts
    ? new Date(ts).toLocaleDateString("en-US", { month: "short", day: "numeric" })
    : "";
}

export function TouchChips({ lead }: { lead: LeadPlus }) {
  const chs = (lead.outreach_channels ?? {}) as Record<string, unknown>;
  const fanbasis = chs.ig_fanbasis as FanbasisTouch;
  const personalBy = (chs.ig_personal_by ?? {}) as Record<string, PersonalTouch>;
  const legacyPersonal = chs.ig_personal as LegacyTouch;
  const linkedin = chs.linkedin as LegacyTouch;

  // One chip per rep with a live personal touch, oldest first (stable order).
  const personalSent = Object.entries(personalBy)
    .filter(([, e]) => e?.sent)
    .sort(([, a], [, b]) => (a?.sentAt ?? 0) - (b?.sentAt ?? 0));

  const fbDone = !!fanbasis?.sent;
  const fbSuffix = [
    fbDone && fanbasis?.byName ? fanbasis.byName : null,
    fbDone && fanbasis?.sentAt ? fmtDate(fanbasis.sentAt) : null,
  ]
    .filter(Boolean)
    .map((p) => ` · ${p}`)
    .join("");

  const liDate = linkedin?.sent && linkedin.sentAt ? ` · ${fmtDate(linkedin.sentAt)}` : "";

  return (
    <div className="flex gap-1.5 flex-wrap">
      {/* Shared FanBasis chip */}
      <span className={fbDone ? TEAL_DONE : GRAY_PENDING}>
        {fbDone ? "✓" : "○"} FanBasis IG
        {fbSuffix}
      </span>

      {/* Per-rep personal chips */}
      {personalSent.length > 0 ? (
        personalSent.map(([repId, e]) => (
          <span
            key={repId}
            className={BLUE_DONE}
            title={[
              e.handle ? `@${String(e.handle).replace(/^@/, "")}` : null,
              fmtDate(e.sentAt),
            ]
              .filter(Boolean)
              .join(" · ")}
          >
            ✓ {e.name || "Rep"}
          </span>
        ))
      ) : legacyPersonal?.sent ? (
        // Old data (≤2.12.0 extensions wrote only the aggregate) — keep the
        // history visible, just unattributed.
        <span className={TEAL_DIMMED} title={fmtDate(legacyPersonal.sentAt)}>
          ✓ Personal (unattributed)
        </span>
      ) : (
        <span className={GRAY_PENDING}>○ Personal IG</span>
      )}

      {/* LinkedIn chip — unchanged behavior: only rendered once sent */}
      {linkedin?.sent && (
        <span className={TEAL_DONE}>
          ✓ LinkedIn
          {liDate}
        </span>
      )}
    </div>
  );
}
