"use client";
import { useEffect, useState, useCallback, useRef } from "react";
import { supabase as getSupabase } from "@/lib/supabase";
import type { Lead } from "@/lib/types";
// Re-export so consumers can import Lead from either place
export type { Lead } from "@/lib/types";

function normalizeLead(raw: Record<string, unknown>): Lead {
  return {
    ...raw,
    research_status:     (raw.research_status as Lead["research_status"]) ?? "none",
    research_cache:      (raw.research_cache as Record<string, unknown>) ?? {},
    ig_events:           (raw.ig_events as Lead["ig_events"]) ?? [],
    tags:                (raw.tags as string[]) ?? [],
    score:               (raw.score as number) ?? 0,
    follower_count:      (raw.follower_count as number | null) ?? null,
    bio:                 (raw.bio as string | null) ?? null,
    sf_account_id:       (raw.sf_account_id as string | null) ?? null,
    sf_account_name:     (raw.sf_account_name as string | null) ?? null,
    sf_status:           (raw.sf_status as Lead["sf_status"]) ?? "none",
    sf_confidence_score: (raw.sf_confidence_score as number) ?? 0,
    sf_match_reasons:    (raw.sf_match_reasons as string[]) ?? [],
    sf_last_checked:     (raw.sf_last_checked as string | null) ?? null,
    outreach_channels:   (raw.outreach_channels as Record<string, unknown>) ?? {},
    outreach_log:        (raw.outreach_log as Record<string, unknown>[]) ?? [],
    dm_sent_at:          (raw.dm_sent_at as string | null) ?? null,
    dq_at:               (raw.dq_at as string | null) ?? null,
    twitter_username:    (raw.twitter_username as string | null) ?? null,
    external_url:        (raw.external_url as string | null) ?? null,
    ig_user_id:          (raw.ig_user_id as string | null) ?? null,
    assigned_to:         (raw.assigned_to as string | null) ?? null,
    owner_id:            (raw.owner_id as string | null) ?? null,
    org_id:              (raw.org_id as string | null) ?? null,
  } as Lead;
}

// Single lead — uses API route to bypass RLS
export function useLead(id: string) {
  const [lead, setLead] = useState<Lead | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch(`/api/leads?id=${id}`);
    if (!res.ok) return;
    const { leads } = await res.json() as { leads: Record<string, unknown>[] };
    setLead(leads?.[0] ? normalizeLead(leads[0]) : null);
    setLoading(false);
  }, [id]);

  useEffect(() => {
    load();

    // Realtime via Supabase for instant research-complete updates
    const db = getSupabase();
    const channel = db
      .channel(`lead-${id}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "leads", filter: `id=eq.${id}` },
        () => load()
      )
      .subscribe();

    return () => { db.removeChannel(channel); };
  }, [id, load]);

  return { lead, loading, refresh: load };
}

// All leads — uses API route to bypass RLS, polls every 30s + debounced realtime trigger
export function useLeads(mode: "sales" | "csm") {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const load = useCallback(async () => {
    const res = await fetch(`/api/leads?mode=${mode}`);
    if (!res.ok) return;
    const { leads: data } = await res.json() as { leads: Record<string, unknown>[] };
    setLeads((data ?? []).map(normalizeLead));
    setLoading(false);
  }, [mode]);

  const debouncedLoad = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => { load(); }, 300);
  }, [load]);

  useEffect(() => {
    load();

    // Poll every 30s as fallback for missed realtime events
    const poll = setInterval(load, 30_000);

    // Realtime — debounced to avoid burst fetches on rapid successive changes
    const db = getSupabase();
    const channel = db
      .channel(`leads-${mode}`)
      .on(
        "postgres_changes",
        // Column-level filter requires REPLICA IDENTITY FULL on the table.
        // Without it Supabase silently drops all events. Subscribe unfiltered;
        // the debounce + 30s poll keep fetches affordable.
        { event: "*", schema: "public", table: "leads" },
        debouncedLoad
      )
      .subscribe();

    return () => {
      clearInterval(poll);
      if (debounceRef.current) clearTimeout(debounceRef.current);
      db.removeChannel(channel);
    };
  }, [mode, load, debouncedLoad]);

  return { leads, loading, refresh: load };
}
