"use client";
import { useEffect, useState, useCallback } from "react";

export type TeamMember = {
  userId: string; name: string; email: string;
  role: "owner" | "admin" | "rep"; capacity: number; openLeads: number;
};
export type Invite = {
  id: string; email: string; role: string; token: string;
  accepted_at: string | null; expires_at: string;
};

// Resilient JSON fetch — TEAM-T1's /api/team & /api/invites may not be live yet
// (or may 403 for a rep). Degrade to an empty payload rather than throwing.
async function safeJson<T>(url: string): Promise<T | null> {
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export function useTeam() {
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invites, setInvites] = useState<Invite[]>([]);
  const [loading, setLoading] = useState(true);

  // No synchronous setState here — loading starts true and we only flip it false
  // after the fetch resolves (matches hooks/useLeads, satisfies react-hooks lint).
  const refresh = useCallback(async () => {
    const [teamRes, invitesRes] = await Promise.all([
      safeJson<{ members?: TeamMember[] }>("/api/team"),
      safeJson<{ invites?: Invite[] }>("/api/invites"),
    ]);
    setMembers(teamRes?.members ?? []);
    setInvites(invitesRes?.invites ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  async function sendInvite(email: string, role: string) {
    try {
      const res = await fetch("/api/invites", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, role }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean; inviteUrl?: string; emailSent?: boolean; error?: string;
      };
      await refresh();
      if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
      return { ok: data.ok ?? true, inviteUrl: data.inviteUrl, emailSent: data.emailSent ?? false, error: data.error };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Network error" };
    }
  }

  // Re-email the invite and extend its expiry 7 days from now.
  async function resendInvite(id: string) {
    try {
      const res = await fetch(`/api/invites/${id}`, { method: "POST" });
      const data = (await res.json().catch(() => ({}))) as {
        ok?: boolean; inviteUrl?: string; emailSent?: boolean; error?: string;
      };
      await refresh();
      if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
      return { ok: true, inviteUrl: data.inviteUrl, emailSent: data.emailSent ?? false };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Network error" };
    }
  }

  // Revoke: the row is deleted, so the emailed link stops working immediately.
  async function revokeInvite(id: string) {
    try {
      const res = await fetch(`/api/invites/${id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; error?: string };
      await refresh();
      if (!res.ok) return { ok: false, error: data.error ?? `HTTP ${res.status}` };
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : "Network error" };
    }
  }

  return { members, invites, loading, sendInvite, resendInvite, revokeInvite, refresh };
}
