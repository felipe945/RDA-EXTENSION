"use client";

import { useEffect, useState } from "react";
import { supabase as getSupabase } from "@/lib/supabase";
import { useMode } from "@/components/ModeProvider";
import type { Lead } from "@/hooks/useLeads";

type BriefingState =
  | { status: "loading" }
  | { status: "ai"; content: string; generatedAt: string }
  | { status: "fallback"; leads: Lead[] }
  | { status: "error"; message: string };

function urgencyLabel(lead: Lead): string {
  if (!lead.due_at) return "No due date";
  const diff = new Date(lead.due_at).getTime() - Date.now();
  if (diff < 0) {
    const h = Math.floor(-diff / 3600000);
    return h < 24 ? `${h}h overdue` : `${Math.floor(h / 24)}d overdue`;
  }
  const h = Math.floor(diff / 3600000);
  if (h < 24) return `due in ${h}h`;
  return `due in ${Math.floor(h / 24)}d`;
}

export default function SummaryPage() {
  const { mode } = useMode();
  const [state, setState] = useState<BriefingState>({ status: "loading" });

  useEffect(() => {
    async function load() {
      setState({ status: "loading" });

      // Try T3's AI summary endpoint first
      try {
        const res = await fetch(`/api/ai/summary?mode=${mode}`, { method: "GET" });
        if (res.ok) {
          const data = await res.json() as { content?: string; generatedAt?: string };
          if (data.content) {
            setState({ status: "ai", content: data.content, generatedAt: data.generatedAt ?? new Date().toISOString() });
            return;
          }
        }
      } catch {
        // endpoint not built yet — fall through to Supabase fallback
      }

      // Fallback: build summary from Supabase lead data
      const { data, error } = await getSupabase()
        .from("leads")
        .select("*")
        .eq("mode", mode)
        .not("due_at", "is", null)
        .order("due_at", { ascending: true })
        .limit(20);

      if (error) {
        setState({ status: "error", message: error.message });
        return;
      }

      setState({ status: "fallback", leads: (data as Lead[]) ?? [] });
    }

    load();
  }, [mode]);

  const today = new Date().toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      <div>
        <h1 className="text-base font-semibold">Morning Briefing</h1>
        <p className="text-xs text-gray-500 mt-0.5">{today}</p>
      </div>

      {state.status === "loading" && (
        <div className="flex items-center gap-3 py-12">
          <span className="w-2 h-2 bg-blue-500 rounded-full animate-pulse" />
          <span className="text-sm text-gray-400">Building your briefing...</span>
        </div>
      )}

      {state.status === "error" && (
        <div className="text-sm text-red-400 bg-red-900/20 border border-red-800 rounded-lg p-4">
          Failed to load briefing: {state.message}
        </div>
      )}

      {state.status === "ai" && (
        <div className="space-y-4">
          <div className="text-xs text-gray-600">
            Generated at {new Date(state.generatedAt).toLocaleTimeString()}
          </div>
          <div className="prose prose-invert prose-sm max-w-none">
            <pre className="text-sm text-gray-200 whitespace-pre-wrap font-sans leading-relaxed bg-gray-900/40 p-4 rounded-lg">
              {state.content}
            </pre>
          </div>
        </div>
      )}

      {state.status === "fallback" && (
        <FallbackBriefing leads={state.leads} mode={mode} />
      )}
    </div>
  );
}

function FallbackBriefing({ leads, mode }: { leads: Lead[]; mode: "sales" | "csm" }) {
  const now = Date.now();
  const endOfDay = new Date();
  endOfDay.setHours(23, 59, 59, 999);

  const overdue = leads.filter((l) => l.due_at && new Date(l.due_at).getTime() < now);
  const dueToday = leads.filter((l) => {
    if (!l.due_at) return false;
    const d = new Date(l.due_at).getTime();
    return d >= now && d <= endOfDay.getTime();
  });
  const upcoming = leads.filter((l) => l.due_at && new Date(l.due_at).getTime() > endOfDay.getTime());

  const label = mode === "sales" ? "leads" : "clients";

  return (
    <div className="space-y-6">
      <div className="text-xs text-amber-600 bg-amber-900/20 border border-amber-800/40 rounded px-3 py-2">
        AI briefing will appear here once /api/ai/summary is live (T3). Showing live data below.
      </div>

      <BriefingSection
        title={`Overdue (${overdue.length})`}
        leads={overdue}
        accent="text-[#d4892a]"
        empty={`No overdue ${label}.`}
      />
      <BriefingSection
        title={`Due Today (${dueToday.length})`}
        leads={dueToday}
        accent="text-[#b8a245]"
        empty={`Nothing due today.`}
      />
      <BriefingSection
        title={`Upcoming (${upcoming.length})`}
        leads={upcoming.slice(0, 5)}
        accent="text-[#3d8b5c]"
        empty={`No upcoming follow-ups.`}
      />
    </div>
  );
}

function BriefingSection({
  title,
  leads,
  accent,
  empty,
}: {
  title: string;
  leads: Lead[];
  accent: string;
  empty: string;
}) {
  return (
    <div className="space-y-2">
      <h2 className={`text-xs font-semibold uppercase tracking-widest ${accent}`}>{title}</h2>
      {leads.length === 0 ? (
        <p className="text-sm text-gray-600">{empty}</p>
      ) : (
        <div className="space-y-1.5">
          {leads.map((lead) => {
            const name = lead.ig_username ? `@${lead.ig_username}` : (lead.name ?? "Unknown");
            return (
              <a
                key={lead.id}
                href={`/leads/${lead.id}`}
                className="flex items-center justify-between px-3 py-2 bg-gray-900 border border-gray-800 rounded-lg hover:border-gray-600 transition-colors"
              >
                <span className="text-sm text-gray-200">{name}</span>
                <div className="flex items-center gap-3 text-xs text-gray-500">
                  <span>{lead.stage}</span>
                  <span className={accent}>{urgencyLabel(lead)}</span>
                </div>
              </a>
            );
          })}
        </div>
      )}
    </div>
  );
}
