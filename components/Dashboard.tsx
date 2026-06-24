"use client";

import { useEffect, useState } from "react";
import { supabase as getSupabase } from "@/lib/supabase";
import LeadCard from "@/components/LeadCard";
import type { Lead } from "@/hooks/useLeads";

type UrgencyBucket = "overdue" | "today" | "upcoming" | "booked" | "archived";

function bucket(lead: Lead): UrgencyBucket {
  if (["Closed", "DQ", "Churned"].includes(lead.stage)) return "archived";
  if (["Booked", "Active"].includes(lead.stage)) return "booked";
  if (!lead.due_at) return "upcoming";
  const due = new Date(lead.due_at);
  const now = new Date();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59);
  if (due < now) return "overdue";
  if (due <= endOfDay) return "today";
  return "upcoming";
}

const BUCKET_ORDER: UrgencyBucket[] = ["overdue", "today", "upcoming", "booked", "archived"];
const BUCKET_LABELS: Record<UrgencyBucket, string> = {
  overdue: "Overdue",
  today: "Due Today",
  upcoming: "Upcoming",
  booked: "Booked / Active",
  archived: "Archived",
};

export default function Dashboard({ mode }: { mode: "sales" | "csm" }) {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [filter, setFilter] = useState<UrgencyBucket | "all">("all");

  useEffect(() => {
    const db = getSupabase();
    async function load() {
      const { data } = await db
        .from("leads")
        .select("*")
        .eq("mode", mode)
        .order("due_at", { ascending: true });
      setLeads(data ?? []);
    }
    load();

    const channel = db
      .channel("leads-realtime")
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => load())
      .subscribe();

    return () => { db.removeChannel(channel); };
  }, [mode]);

  const grouped = BUCKET_ORDER.reduce<Record<UrgencyBucket, Lead[]>>(
    (acc, b) => ({ ...acc, [b]: [] }),
    {} as Record<UrgencyBucket, Lead[]>
  );
  for (const lead of leads) {
    grouped[bucket(lead)].push(lead);
  }

  const visibleBuckets = filter === "all"
    ? BUCKET_ORDER.filter((b) => grouped[b].length > 0)
    : [filter];

  return (
    <div className="space-y-8">
      {/* Filters */}
      <div className="flex gap-2 flex-wrap">
        {(["all", ...BUCKET_ORDER] as const).map((f) => (
          <button
            key={f}
            onClick={() => setFilter(f)}
            className={`px-3 py-1 rounded-full text-xs font-medium border transition-colors ${
              filter === f
                ? "border-gray-400 bg-gray-700 text-white"
                : "border-gray-700 text-gray-400 hover:border-gray-500"
            }`}
          >
            {f === "all" ? "All" : BUCKET_LABELS[f]}
            {f !== "all" && ` (${grouped[f].length})`}
          </button>
        ))}
      </div>

      {/* Buckets */}
      {visibleBuckets.map((b) => (
        <section key={b}>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-gray-500 mb-3">
            {BUCKET_LABELS[b]} ({grouped[b].length})
          </h2>
          <div className="space-y-2">
            {grouped[b].map((lead) => (
              <LeadCard key={lead.id} lead={lead} urgency={b} />
            ))}
          </div>
        </section>
      ))}

      {leads.length === 0 && (
        <div className="text-center text-gray-600 py-20 text-sm">
          No leads yet. Connect the Chrome extension or add one manually.
        </div>
      )}
    </div>
  );
}
