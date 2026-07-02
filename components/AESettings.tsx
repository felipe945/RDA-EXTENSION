"use client";
// Account Executives — admin-managed list of who discovery calls get booked
// with. The booking calendar reads live free/busy off these emails, so they
// must be real Google Workspace accounts (normally @fanbasis.com).
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF3A69]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070B12]";

type Ae = { id: string; name: string; email: string; active: boolean };

export function AESettings() {
  const toast = useToast();
  const [aes, setAes] = useState<Ae[] | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/aes");
      const data = (await res.json().catch(() => null)) as { ok: boolean; aes?: Ae[] } | null;
      setAes(data?.ok ? data.aes ?? [] : []);
    } catch {
      setAes([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleAdd() {
    if (!name.trim() || !email.trim()) return;
    setSaving(true);
    try {
      const res = await fetch("/api/aes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), email: email.trim() }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; ae?: Ae; error?: string }
        | null;
      if (data?.ok && data.ae) {
        setAes((prev) => [...(prev ?? []), data.ae!]);
        setName("");
        setEmail("");
        toast.success(`${data.ae.name} added — reps can book on their calendar now`);
      } else {
        toast.error(data?.error ?? "Failed to add AE");
      }
    } catch {
      toast.error("Failed to add AE — network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(ae: Ae) {
    setBusyId(ae.id);
    try {
      const res = await fetch(`/api/aes/${ae.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null;
      if (data?.ok) {
        setAes((prev) => (prev ?? []).filter((a) => a.id !== ae.id));
        toast.info(`${ae.name} removed from the AE list`);
      } else {
        toast.error(data?.error ?? "Failed to remove AE");
      }
    } catch {
      toast.error("Failed to remove AE — network error");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[#94A3B8]">
        Account Executives
      </h2>
      <p className="mb-3 text-xs text-[#5B6B8C]">
        Discovery calls get booked against these calendars — availability is read live from their
        Google Calendar. They don&apos;t need a dashboard account.
      </p>

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="AE name"
          aria-label="AE name"
          className="w-40 rounded-lg border border-[#1A2235] bg-[#0F1420] px-3 py-2 text-sm text-[#E2E8F0] outline-none focus:border-[#2A3554]"
        />
        <input
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="ae@fanbasis.com"
          type="email"
          aria-label="AE email address"
          className="flex-1 rounded-lg border border-[#1A2235] bg-[#0F1420] px-3 py-2 text-sm text-[#E2E8F0] outline-none focus:border-[#2A3554]"
        />
        <button
          onClick={handleAdd}
          disabled={saving || !name.trim() || !email.trim()}
          className={`rounded-lg bg-[#FF3A69] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#E02F5D] disabled:opacity-50 ${FOCUS_RING}`}
        >
          {saving ? "Adding…" : "Add AE"}
        </button>
      </div>

      {aes === null ? (
        <div className="mt-3 flex flex-col gap-2">
          <Skeleton className="h-10 w-full bg-[#1E2640]" />
        </div>
      ) : aes.length === 0 ? (
        <div className="mt-3">
          <EmptyState
            icon="📅"
            title="No AEs yet"
            description="Until you add one, booking uses each rep's own calendar. Add your AEs so reps book against real AE availability."
          />
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2">
          {aes.map((ae) => (
            <li
              key={ae.id}
              className="flex flex-wrap items-center gap-2.5 rounded-lg border border-[#1A2235] bg-[#0F1420] px-3 py-2 text-sm"
            >
              <span className="font-medium text-[#E2E8F0]">{ae.name}</span>
              <span className="text-xs text-[#5B6B8C]">{ae.email}</span>
              <span className="ml-auto">
                <button
                  onClick={() => handleRemove(ae)}
                  disabled={busyId === ae.id}
                  className={`rounded-md border border-[#3d2230] bg-[#151B2E] px-2.5 py-1 text-[11.5px] font-semibold text-[#F0A5B8] transition-colors hover:border-[#5A3040] hover:bg-[#2A1420] disabled:opacity-50 ${FOCUS_RING}`}
                >
                  {busyId === ae.id ? "…" : "Remove"}
                </button>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
