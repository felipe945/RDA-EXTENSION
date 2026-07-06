"use client";
import { useEffect, useState, useCallback } from "react";
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

// data-C1 note: these hooks used to pair the API fetch with an anon-key
// Supabase realtime subscription. Migration 020 revoked anon SELECT on leads,
// which silently kills anon `postgres_changes` — so realtime is gone (Option B)
// and a 30s poll is the sole background refresh. `refresh` remains for
// action-driven updates (the dashboard already refetches after mutations).

// Single lead — uses API route (server-side scoping), polls every 30s so
// research-complete flips still show up without a manual refresh.
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
    const poll = setInterval(load, 30_000);
    return () => { clearInterval(poll); };
  }, [load]);

  return { lead, loading, refresh: load };
}

// All leads — uses API route (server-side scoping), polls every 30s.
// scope (Contract SCOPE): "mine" = unclaimed pool + claimed-by-me, "team" = whole
// org (admin only). Omitted = legacy server behavior, so existing callers are unchanged.
export function useLeads(mode: "sales" | "csm", scope?: "mine" | "team") {
  const [leads, setLeads] = useState<Lead[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    const res = await fetch(`/api/leads?mode=${mode}${scope ? `&scope=${scope}` : ""}`);
    if (!res.ok) return;
    const { leads: data } = await res.json() as { leads: Record<string, unknown>[] };
    setLeads((data ?? []).map(normalizeLead));
    setLoading(false);
  }, [mode, scope]);

  useEffect(() => {
    load();
    const poll = setInterval(load, 30_000);
    return () => { clearInterval(poll); };
  }, [load]);

  return { leads, loading, refresh: load };
}
