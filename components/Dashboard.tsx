"use client";

import { useState } from "react";
import { useSession } from "next-auth/react";
import { useLeads } from "@/hooks/useLeads";
import { useTeam } from "@/hooks/useTeam";
import { canSeeAllLeads } from "@/lib/permissions";
import LeadCard from "@/components/LeadCard";
import AddLeadModal from "@/components/AddLeadModal";
import ImportLeadsModal from "@/components/ImportLeadsModal";
import Link from "next/link";
import type { Lead } from "@/hooks/useLeads";
import { LeadCardSkeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { type LeadPlus } from "@/components/ig";
import { ownerLabel as getOwnerLabel } from "@/components/OwnerControl";
import { RepStatsPanel } from "@/components/RepStatsPanel";

type UrgencyBucket = "overdue" | "today" | "upcoming" | "booked" | "archived";
type SourceTab = "all" | "IG" | "Email" | "LinkedIn" | "Manual";

type PipelineFilter =
  | "all"
  | "needs_fu"
  | "new"
  | "warming"
  | "dm_sent"
  | "replied"
  | "qualifying"
  | "call_offered"
  | "booked"
  | "closed";

const PIPELINE_FILTERS: { key: PipelineFilter; label: string; color: string }[] = [
  { key: "all",          label: "All",             color: "" },
  { key: "needs_fu",     label: "Needs Follow Up", color: "#FF3A69" },
  { key: "new",          label: "New",             color: "#64748b" },
  { key: "warming",      label: "Warming",         color: "#f59e0b" },
  { key: "dm_sent",      label: "DM Sent",         color: "#3b82f6" },
  { key: "replied",      label: "Replied",         color: "#8b5cf6" },
  { key: "qualifying",   label: "Qualifying",      color: "#06b6d4" },
  { key: "call_offered", label: "Call Offered",    color: "#10b981" },
  { key: "booked",       label: "Booked",          color: "#22c55e" },
  { key: "closed",       label: "Closed",          color: "#6b7280" },
];

function urgencyBucket(lead: Lead): UrgencyBucket {
  if (["Closed", "DQ", "Churned"].includes(lead.stage)) return "archived";
  if (["Booked", "Active"].includes(lead.stage)) return "booked";
  if (lead.stage === "Replied" || lead.stage === "At Risk") return "today";
  if (!lead.due_at) return "upcoming";
  const due = new Date(lead.due_at);
  const now = new Date();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  if (due < now) return "overdue";
  if (due <= endOfDay) return "today";
  return "upcoming";
}

function needsFollowUp(lead: Lead): boolean {
  const b = urgencyBucket(lead);
  return b === "overdue" || b === "today";
}

function pipelineMatch(lead: Lead, filter: PipelineFilter): boolean {
  switch (filter) {
    case "all":          return !["Closed", "DQ", "Churned"].includes(lead.stage);
    case "needs_fu":     return needsFollowUp(lead);
    case "new":          return lead.stage === "New";
    case "warming":      return lead.stage === "Warming";
    case "dm_sent":      return lead.stage === "DM Sent";
    case "replied":      return lead.stage === "Replied";
    case "qualifying":   return lead.stage === "Qualifying";
    case "call_offered": return lead.stage === "Call Offered";
    case "booked":       return ["Booked", "Active"].includes(lead.stage);
    case "closed":       return ["Closed", "DQ", "Churned"].includes(lead.stage);
  }
}

const BUCKET_ORDER: UrgencyBucket[] = ["overdue", "today", "upcoming", "booked", "archived"];
const BUCKET_LABELS: Record<UrgencyBucket, string> = {
  overdue:  "Needs Follow Up",
  today:    "Due Today",
  upcoming: "Upcoming",
  booked:   "Booked / Active",
  archived: "Archived",
};
const BUCKET_COLORS: Record<UrgencyBucket, string> = {
  overdue:  "text-[#FF3A69]",
  today:    "text-[#f59e0b]",
  upcoming: "text-gray-500",
  booked:   "text-[#22c55e]",
  archived: "text-gray-600",
};

const SOURCE_TABS: { key: SourceTab; label: string; icon: string }[] = [
  { key: "all",      label: "All",       icon: "⬡" },
  { key: "IG",       label: "Instagram", icon: "📸" },
  { key: "Email",    label: "Email",     icon: "✉" },
  { key: "LinkedIn", label: "LinkedIn",  icon: "in" },
  { key: "Manual",   label: "Manual",    icon: "✎" },
];

function BatchResearchButton({ leads }: { leads: Lead[] }) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);

  async function runAll() {
    setRunning(true);
    setDone(0);
    for (const lead of leads) {
      try {
        await fetch("/api/ai/research-lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: lead.id }),
        });
      } catch { /* continue on individual failure */ }
      setDone(d => d + 1);
    }
    setRunning(false);
  }

  return (
    <button
      onClick={runAll}
      disabled={running}
      className="text-xs px-3 py-1.5 border border-gray-700 rounded-md text-gray-400 hover:text-white hover:border-gray-500 transition-colors disabled:opacity-50"
    >
      {running ? `Researching ${done}/${leads.length}…` : `Research All (${leads.length})`}
    </button>
  );
}

export default function Dashboard({ mode }: { mode: "sales" | "csm" }) {
  const { leads: allLeads, loading, refresh } = useLeads(mode);
  const { members } = useTeam();
  const { data: session } = useSession();
  const [pipelineFilter, setPipelineFilter] = useState<PipelineFilter>("all");
  const [source, setSource] = useState<SourceTab>("all");
  const [showAddLead, setShowAddLead] = useState(false);
  const [showImport, setShowImport] = useState(false);
  const [search, setSearch] = useState("");
  const [scope, setScope] = useState<"mine" | "team">("mine");

  const userId = session?.userId;
  // The server already scopes what reps receive (C1: cold pool + own). The
  // toggle is a view convenience for owner/admin only — reps never see it.
  const showTeamToggle = canSeeAllLeads(session?.role);

  const memberName = (id: string | null): string | undefined =>
    id ? members.find((m) => m.userId === id)?.name : undefined;

  // Hybrid ownership: "Mine" = leads I've claimed (owner_id — stamped by the
  // server when I send the DM). If userId isn't known yet, don't hide
  // everything — fall back to showing all so the dashboard never goes blank.
  const leads =
    scope === "team" || !userId
      ? allLeads
      : allLeads.filter((l) => (l as LeadPlus).owner_id === userId);

  const pendingResearch = leads.filter(
    (l) => l.research_status === "pending" || l.research_status === "none"
  );

  const sourceFiltered = source === "all"
    ? leads
    : leads.filter((l) => {
        if (source === "IG") return l.source === "IG" || !!l.ig_username;
        if (source === "Email") return l.source === "Email" || !!l.email;
        if (source === "LinkedIn") return l.source === "LinkedIn" || !!l.linkedin_url;
        if (source === "Manual") return l.source === "Manual" || (!l.ig_username && !l.email && !l.linkedin_url);
        return true;
      });

  const searchFiltered = search.trim()
    ? sourceFiltered.filter((l) => {
        const q = search.toLowerCase();
        return (
          l.ig_username?.toLowerCase().includes(q) ||
          l.name?.toLowerCase().includes(q) ||
          l.email?.toLowerCase().includes(q) ||
          l.phone?.includes(q) ||
          l.notes?.toLowerCase().includes(q)
        );
      })
    : sourceFiltered;

  const pipelineFiltered = searchFiltered.filter((l) => pipelineMatch(l, pipelineFilter));

  const grouped = BUCKET_ORDER.reduce<Record<UrgencyBucket, Lead[]>>(
    (acc, b) => ({ ...acc, [b]: [] }),
    {} as Record<UrgencyBucket, Lead[]>
  );
  for (const lead of pipelineFiltered) {
    grouped[urgencyBucket(lead)].push(lead);
  }
  const visibleBuckets = BUCKET_ORDER.filter((b) => grouped[b].length > 0);

  if (loading) {
    return (
      <div className="space-y-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <LeadCardSkeleton key={i} />
          ))}
        </div>
      </div>
    );
  }

  const needsFUCount = searchFiltered.filter(needsFollowUp).length;
  const repliedCount = searchFiltered.filter((l) => l.stage === "Replied").length;
  const bookedCount  = searchFiltered.filter((l) => ["Booked", "Active"].includes(l.stage)).length;
  const batchLeads   = leads.filter(l => l.research_status === "none");

  return (
    <div className="space-y-5">
      {/* Research pending banner */}
      {pendingResearch.length > 0 && (
        <div className="flex items-center justify-between rounded-xl border px-4 py-3" style={{ background: '#0F1420', borderColor: '#1A2235' }}>
          <div className="flex items-center gap-3">
            <span className="w-2 h-2 rounded-full bg-[#FF3A69] animate-pulse-dot shrink-0" />
            <span className="text-sm text-gray-300">
              <span className="font-medium text-white">{pendingResearch.length} leads</span> pending AI research
            </span>
          </div>
          <div className="flex gap-2">
            {batchLeads.length > 0 && <BatchResearchButton leads={batchLeads} />}
            <Link
              href="/outreach"
              className="text-xs px-3 py-1.5 bg-[#FF3A69] text-white rounded-md font-medium hover:bg-[#e03060] transition-colors"
            >
              Go to Outreach →
            </Link>
          </div>
        </div>
      )}

      {/* Priority stat cards */}
      {(needsFUCount > 0 || repliedCount > 0 || bookedCount > 0) && (
        <div className="grid grid-cols-3 gap-3">
          {needsFUCount > 0 && (
            <button
              onClick={() => setPipelineFilter(pipelineFilter === "needs_fu" ? "all" : "needs_fu")}
              className="card-hover rounded-xl border p-4 text-left transition-colors relative overflow-hidden"
              style={pipelineFilter === "needs_fu"
                ? { borderColor: '#FF3A69', background: 'linear-gradient(135deg, rgba(255,58,105,0.12), rgba(255,58,105,0.04))' }
                : { borderColor: '#1A2235', background: 'linear-gradient(135deg, #0F1420, #070B12)' }}>
              <div className="flex items-start justify-between mb-2">
                <p className="text-2xl font-bold tabular-nums" style={{ color: '#FF3A69' }}>{needsFUCount}</p>
                <div className="w-2 h-2 rounded-full animate-pulse-dot mt-1" style={{ background: '#FF3A69' }} />
              </div>
              <p className="text-xs font-medium" style={{ color: '#475569' }}>Follow Up</p>
              <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-b-xl" style={{ background: 'linear-gradient(90deg, #FF3A69, transparent)' }} />
            </button>
          )}
          {repliedCount > 0 && (
            <button
              onClick={() => setPipelineFilter(pipelineFilter === "replied" ? "all" : "replied")}
              className="card-hover rounded-xl border p-4 text-left transition-colors relative overflow-hidden"
              style={pipelineFilter === "replied"
                ? { borderColor: '#A78BFA', background: 'linear-gradient(135deg, rgba(167,139,250,0.12), rgba(167,139,250,0.04))' }
                : { borderColor: '#1A2235', background: 'linear-gradient(135deg, #0F1420, #070B12)' }}>
              <div className="flex items-start justify-between mb-2">
                <p className="text-2xl font-bold tabular-nums" style={{ color: '#A78BFA' }}>{repliedCount}</p>
                <div className="w-2 h-2 rounded-full animate-pulse-dot mt-1" style={{ background: '#A78BFA', animationDelay: '0.3s' }} />
              </div>
              <p className="text-xs font-medium" style={{ color: '#475569' }}>Replied</p>
              <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-b-xl" style={{ background: 'linear-gradient(90deg, #A78BFA, transparent)' }} />
            </button>
          )}
          {bookedCount > 0 && (
            <button
              onClick={() => setPipelineFilter(pipelineFilter === "booked" ? "all" : "booked")}
              className="card-hover rounded-xl border p-4 text-left transition-colors relative overflow-hidden"
              style={pipelineFilter === "booked"
                ? { borderColor: '#22C55E', background: 'linear-gradient(135deg, rgba(34,197,94,0.1), rgba(34,197,94,0.03))' }
                : { borderColor: '#1A2235', background: 'linear-gradient(135deg, #0F1420, #070B12)' }}>
              <div className="flex items-start justify-between mb-2">
                <p className="text-2xl font-bold tabular-nums" style={{ color: '#22C55E' }}>{bookedCount}</p>
                <div className="w-2 h-2 rounded-full mt-1" style={{ background: '#22C55E', borderRadius: '50%' }} />
              </div>
              <p className="text-xs font-medium" style={{ color: '#475569' }}>Booked</p>
              <div className="absolute bottom-0 left-0 right-0 h-0.5 rounded-b-xl" style={{ background: 'linear-gradient(90deg, #22C55E, transparent)' }} />
            </button>
          )}
        </div>
      )}

      {/* My Leads / Team Leads toggle — owner/admin only */}
      {showTeamToggle && (
        <div className="flex rounded-lg border border-[#1A2235] p-0.5 w-fit">
          <button
            onClick={() => setScope("mine")}
            className={`rounded-md px-3 py-1.5 text-xs transition-colors ${scope === "mine" ? "bg-[#1E2640] text-[#E2E8F0]" : "text-[#94A3B8]"}`}
          >
            My Leads
          </button>
          <button
            onClick={() => setScope("team")}
            className={`rounded-md px-3 py-1.5 text-xs transition-colors ${scope === "team" ? "bg-[#1E2640] text-[#E2E8F0]" : "text-[#94A3B8]"}`}
          >
            Team Leads
          </button>
        </div>
      )}

      {/* Per-rep attribution — admin, team view only (C6; hides itself if the
          endpoint isn't live or returns 403) */}
      {showTeamToggle && scope === "team" && <RepStatsPanel />}

      {/* Source tabs */}
      <div className="flex items-center gap-1 border-b pb-1 overflow-x-auto" style={{ borderColor: '#1A2235' }}>
        {SOURCE_TABS.map(({ key, label, icon }) => {
          const count = key === "all"
            ? leads.length
            : leads.filter((l) => {
                if (key === "IG") return l.source === "IG" || !!l.ig_username;
                if (key === "Email") return l.source === "Email" || !!l.email;
                if (key === "LinkedIn") return l.source === "LinkedIn" || !!l.linkedin_url;
                if (key === "Manual") return l.source === "Manual";
                return true;
              }).length;
          if (count === 0 && key !== "all") return null;
          return (
            <button
              key={key}
              onClick={() => setSource(key)}
              className={`flex items-center gap-1.5 px-3 py-1.5 rounded-t-md text-sm font-medium transition-colors whitespace-nowrap ${
                source === key
                  ? "text-white border-b-2 border-[#FF3A69] -mb-[1px]"
                  : "text-gray-500 hover:text-gray-300"
              }`}
            >
              <span className="text-xs">{icon}</span>
              {label}
              <span className={`text-xs ${source === key ? "text-gray-400" : "text-gray-600"}`}>{count}</span>
            </button>
          );
        })}
      </div>

      {/* Search bar */}
      <div className="relative">
        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search leads by name, @handle, email..."
          className="w-full text-sm rounded-lg px-3 py-2 pl-8 outline-none transition-colors" style={{ background: '#0F1420', border: '1px solid #1A2235', color: '#CBD5E1' }}
        />
        <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 text-sm">⌕</span>
        {search && (
          <button
            onClick={() => setSearch("")}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300 text-sm"
          >
            ✕
          </button>
        )}
      </div>
      {search && (
        <p className="text-xs text-gray-600">
          {searchFiltered.length} result{searchFiltered.length !== 1 ? "s" : ""} for &ldquo;{search}&rdquo;
        </p>
      )}

      {/* Pipeline filter pills */}
      <div className="flex gap-1.5 flex-wrap">
        {PIPELINE_FILTERS.map(({ key, label, color }) => {
          const count = searchFiltered.filter((l) => pipelineMatch(l, key)).length;
          if (count === 0 && key !== "all") return null;
          const isActive = pipelineFilter === key;
          return (
            <button
              key={key}
              onClick={() => setPipelineFilter(key)}
              style={isActive && color ? { borderColor: color, color } : undefined}
              className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
                isActive
                  ? "bg-gray-800"
                  : "border-[#1A2235] text-[#475569] hover:border-[#2A3554] hover:text-[#94A3B8]"
              } ${!color && isActive ? "border-gray-400 text-white" : ""}`}
            >
              {label} <span className="opacity-60">{count}</span>
            </button>
          );
        })}
      </div>

      {/* Lead groups */}
      {visibleBuckets.map((b) => (
        <section key={b}>
          <h2 className={`text-xs font-semibold uppercase tracking-widest mb-3 ${BUCKET_COLORS[b]}`}>
            {BUCKET_LABELS[b]} <span className="opacity-60">({grouped[b].length})</span>
          </h2>
          <div className="space-y-2">
            {grouped[b].map((lead) => (
              <LeadCard
                key={lead.id}
                lead={lead}
                urgency={b}
                ownerLabel={getOwnerLabel(lead as LeadPlus, userId, memberName)}
              />
            ))}
          </div>
        </section>
      ))}

      {pipelineFiltered.length === 0 && (
        leads.length === 0 ? (
          <EmptyState
            icon="📸"
            title="No leads yet"
            description="Save an Instagram profile using the Chrome extension, or add a lead manually to get started."
            actionLabel="Add Lead"
            onAction={() => setShowAddLead(true)}
          />
        ) : pipelineFilter === "needs_fu" ? (
          <EmptyState
            icon="✓"
            title="You're caught up"
            description="No overdue follow-ups. Check back after your DMs go out."
          />
        ) : (
          <EmptyState
            icon="○"
            title="Nothing here"
            description="No leads match this filter right now."
          />
        )
      )}

      {/* Floating action buttons */}
      <div className="fixed bottom-6 right-6 z-40 flex items-center gap-2">
        <button
          onClick={() => setShowImport(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-gray-800 hover:bg-gray-700 border border-gray-700 text-gray-200 font-semibold rounded-full shadow-lg transition-colors text-sm"
        >
          <span className="text-base leading-none">⇪</span>
          Import
        </button>
        <button
          onClick={() => setShowAddLead(true)}
          className="flex items-center gap-2 px-4 py-2.5 bg-[#FF3A69] hover:bg-[#e03060] text-white font-semibold rounded-full shadow-lg transition-colors text-sm"
        >
          <span className="text-lg leading-none">+</span>
          Add Lead
        </button>
      </div>

      {showAddLead && (
        <AddLeadModal
          onClose={() => setShowAddLead(false)}
          onAdded={() => refresh()}
        />
      )}

      {showImport && (
        <ImportLeadsModal
          onClose={() => setShowImport(false)}
          onImported={() => refresh()}
        />
      )}
    </div>
  );
}
