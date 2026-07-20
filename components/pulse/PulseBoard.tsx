"use client";
// Pulse board — the only alert surface for the account watchdog (no digests,
// no sends). Polls like the rest of the app (no Realtime, Option B).
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { canManageTeam } from "@/lib/permissions";
import { useToast } from "@/components/ui/toast";
import { Flame, CircleAlert, Inbox, CheckCircle2 } from "lucide-react";
import { PulseCard, type PulseConvo, channelGlyph } from "@/components/pulse/PulseCard";

type Sources = Record<string, { lastHeartbeatAt: string | null; stale: boolean }>;
type BoardData = {
  conversations: PulseConvo[];
  counts: { red: number; amber: number; green: number; untracked: number };
  sources: Sources;
};

function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

export function PulseBoard() {
  const { data: session } = useSession();
  const toast = useToast();
  const [board, setBoard] = useState<BoardData | null>(null);
  const [untracked, setUntracked] = useState<PulseConvo[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [tick, setTick] = useState(0); // bumped by actions to force a reload

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        const [boardRes, untrackedRes] = await Promise.all([
          fetch("/api/am/conversations?view=board"),
          fetch("/api/am/conversations?view=untracked"),
        ]);
        if (cancelled) return;
        if (boardRes.ok) setBoard(await boardRes.json());
        if (untrackedRes.ok) {
          const { conversations = [] } = await untrackedRes.json();
          if (!cancelled) setUntracked(conversations);
        }
      } catch {
        // polling — next tick retries
      } finally {
        if (!cancelled) setLoaded(true);
      }
    }
    load();
    const interval = setInterval(load, 60_000);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [tick]);

  const patch = useCallback(
    async (id: string, body: Record<string, unknown>, okMsg?: string) => {
      const res = await fetch(`/api/am/conversations/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        if (okMsg) toast.success(okMsg);
        setTick((t) => t + 1);
      } else {
        toast.error("Update failed");
      }
    },
    [toast]
  );

  // Cosmetic gate — the API already 401s non-admins.
  if (!canManageTeam(session?.role)) return null;

  const convos = board?.conversations ?? [];
  const fires = convos.filter((c) => c.status === "red");
  const actions = convos.filter((c) => c.status === "amber");
  const good = convos.filter((c) => c.status === "green");

  // Feed health: red banner only for a feed that HAS heartbeated and went
  // quiet. A feed that never connected gets a setup hint, not an alarm.
  const staleFeeds = Object.entries(board?.sources ?? {}).filter(
    ([, s]) => s.stale && s.lastHeartbeatAt !== null
  );
  const neverConnected = Object.entries(board?.sources ?? {}).filter(
    ([, s]) => s.lastHeartbeatAt === null
  );

  return (
    <div className="space-y-6">
      {staleFeeds.length > 0 && (
        <div
          role="alert"
          className="rounded-lg border px-4 py-3 text-sm font-medium"
          style={{ background: "#2A1420", borderColor: "#FF3A69", color: "#FCA5C0" }}
        >
          ⚠️{" "}
          {staleFeeds
            .map(([ch, s]) => `${ch === "slack" ? "Slack" : "WhatsApp"} feed offline since ${fmtTime(s.lastHeartbeatAt!)}`)
            .join(" · ")}{" "}
          — statuses below may be stale. Check pulse-bridge on your Mac: <code>pm2 status</code>
        </div>
      )}
      {loaded && neverConnected.length > 0 && convos.length === 0 && untracked.length === 0 && (
        <div
          className="rounded-lg border px-4 py-3 text-sm"
          style={{ background: "#0F1420", borderColor: "#1A2235", color: "#94A3B8" }}
        >
          No feeds connected yet. Start <code>workers/pulse-bridge</code> on your Mac (see its
          README) — threads will appear here for triage as it sweeps.
        </div>
      )}

      <Section
        icon={<Flame size={15} style={{ color: "#EF4444" }} />}
        title="Fires"
        count={fires.length}
        emptyText="No fires. Nothing is burning."
      >
        {fires.map((c) => (
          <PulseCard key={c.id} convo={c} onPatch={patch} />
        ))}
      </Section>

      <Section
        icon={<CircleAlert size={15} style={{ color: "#d4892a" }} />}
        title="Next actions"
        count={actions.length}
        emptyText="Nothing needs a move from you."
      >
        {actions.map((c) => (
          <PulseCard key={c.id} convo={c} onPatch={patch} />
        ))}
      </Section>

      {untracked.length > 0 && (
        <Section
          icon={<Inbox size={15} style={{ color: "#60A5FA" }} />}
          title="New — track as client?"
          count={untracked.length}
        >
          {untracked.map((c) => (
            <UntrackedRow key={c.id} convo={c} onPatch={patch} />
          ))}
        </Section>
      )}

      <details className="group">
        <summary className="flex cursor-pointer select-none items-center gap-2 text-sm font-semibold text-[#5B6B8C] hover:text-[#94A3B8]">
          <CheckCircle2 size={15} style={{ color: "#14B8A6" }} />
          All good
          <span className="text-xs font-normal">({good.length})</span>
        </summary>
        <div className="mt-3 space-y-2">
          {good.map((c) => (
            <PulseCard key={c.id} convo={c} onPatch={patch} />
          ))}
        </div>
      </details>
    </div>
  );
}

function Section({
  icon,
  title,
  count,
  emptyText,
  children,
}: {
  icon: React.ReactNode;
  title: string;
  count: number;
  emptyText?: string;
  children: React.ReactNode;
}) {
  return (
    <section>
      <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-[#E2E8F0]">
        {icon}
        {title}
        <span className="text-xs font-normal text-[#5B6B8C]">({count})</span>
      </h2>
      {count === 0 && emptyText ? (
        <p className="rounded-lg border border-[#1A2235] px-4 py-3 text-sm text-[#5B6B8C]">
          {emptyText}
        </p>
      ) : (
        <div className="space-y-2">{children}</div>
      )}
    </section>
  );
}

function UntrackedRow({
  convo,
  onPatch,
}: {
  convo: PulseConvo;
  onPatch: (id: string, body: Record<string, unknown>, okMsg?: string) => void;
}) {
  return (
    <div
      className="flex items-center gap-3 rounded-lg border px-3 py-2"
      style={{ background: "#0F1420", borderColor: "#1A2235" }}
    >
      {channelGlyph(convo.channel)}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm text-[#E2E8F0]">
          {convo.display_name ?? convo.external_id}
        </p>
        {convo.last_msg_preview && (
          <p className="truncate text-xs text-[#5B6B8C]">{convo.last_msg_preview}</p>
        )}
      </div>
      <button
        onClick={() => onPatch(convo.id, { tracked: true }, "Tracking as client")}
        className="shrink-0 rounded-md px-2.5 py-1 text-xs font-semibold text-white transition-opacity hover:opacity-85"
        style={{ background: "#FF3A69" }}
      >
        Track
      </button>
      <button
        onClick={() => onPatch(convo.id, { muted: true }, "Ignored")}
        className="shrink-0 rounded-md border px-2.5 py-1 text-xs font-medium transition-colors"
        style={{ borderColor: "#1A2235", color: "#5B6B8C" }}
      >
        Ignore
      </button>
    </div>
  );
}
