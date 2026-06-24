"use client";
import { useEffect, useState } from "react";
import { supabase as getSupabase } from "@/lib/supabase";

export type Lead = {
  id: string;
  created_at: string;
  updated_at: string;
  name: string | null;
  ig_username: string | null;
  ig_profile_url: string | null;
  linkedin_url: string | null;
  phone: string | null;
  email: string | null;
  stage: string;
  source: string | null;
  mode: string;
  due_at: string | null;
  last_contact_at: string | null;
  ig_events: { type: string; postUrl: string | null; ts: string }[];
  notes: string | null;
  tags: string[];
  research_status: "none" | "pending" | "complete" | "error";
  research_cache: Record<string, unknown>;
  outreach_log: Record<string, unknown>[] | null;
  score: number | null;
};

function normalizeLead(raw: Record<string, unknown>): Lead {
  return {
    ...raw,
    research_status: (raw.research_status as Lead["research_status"]) ?? "none",
    research_cache: (raw.research_cache as Record<string, unknown>) ?? {},
    ig_events: (raw.ig_events as Lead["ig_events"]) ?? [],
    tags: (raw.tags as string[]) ?? [],
    outreach_log: (raw.outreach_log as Record<string, unknown>[] | null) ?? null,
    score: (raw.score as number | null) ?? null,
  } as Lead;
}

export function useLead(id: string) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const db = getSupabase();

    async function load() {
      const { data } = await db.from("leads").select("*").eq("id", id).single();
      setLead(data ? normalizeLead(data as Record<string, unknown>) : null);
      setLoading(false);
    }
    load();

    const channel = db
      .channel(`lead-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `id=eq.${id}` },
        (payload) => setLead(normalizeLead(payload.new as Record<string, unknown>))
      )
      .subscribe();

    return () => { db.removeChannel(channel); };
  }, [id]);

  return { lead, loading };
}

export function useLeads(mode: "sales" | "csm") {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  // loadRef allows calling refresh() from outside without stale closure
  let loadFn: (() => Promise<void>) | null = null;

  useEffect(() => {
    const db = getSupabase();

    async function load() {
      const { data } = await db
        .from("leads")
        .select("*")
        .eq("mode", mode)
        .order("due_at", { ascending: true, nullsFirst: false });
      setLeads(
        ((data as Record<string, unknown>[]) ?? []).map(normalizeLead)
      );
      setLoading(false);
    }

    loadFn = load;
    load();

    const channel = db
      .channel(`leads-${mode}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "leads" }, () => load())
      .subscribe();

    return () => { db.removeChannel(channel); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  function refresh() {
    if (loadFn) loadFn();
  }

  return { leads, loading, refresh };
}
