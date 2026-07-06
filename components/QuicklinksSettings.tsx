"use client";
// Quicklinks manager — the single place links are managed. Admins add TEAM
// links (org-wide, show for everyone in the extension); anyone adds their own
// PERSONAL links. The extension reads these via bootstrap and renders them
// read-only, so there are no link settings inside the extension.
import { useCallback, useEffect, useState } from "react";
import { useToast } from "@/components/ui/toast";
import { Skeleton } from "@/components/ui/skeleton";

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FF3A69]/60 focus-visible:ring-offset-2 focus-visible:ring-offset-[#070B12]";

type Link = { id: string; label: string; url: string };
type Scope = "team" | "personal";

export function QuicklinksSettings() {
  const toast = useToast();
  const [team, setTeam] = useState<Link[] | null>(null);
  const [personal, setPersonal] = useState<Link[]>([]);
  const [admin, setAdmin] = useState(false);
  const [label, setLabel] = useState("");
  const [url, setUrl] = useState("");
  const [scope, setScope] = useState<Scope>("personal");
  const [saving, setSaving] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/quicklinks");
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; team?: Link[]; personal?: Link[]; admin?: boolean }
        | null;
      setTeam(data?.ok ? data.team ?? [] : []);
      setPersonal(data?.ok ? data.personal ?? [] : []);
      setAdmin(!!data?.admin);
    } catch {
      setTeam([]);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function handleAdd() {
    const l = label.trim();
    let u = url.trim();
    if (!l || !u) return;
    if (!/^https?:\/\//i.test(u)) u = "https://" + u;
    setSaving(true);
    try {
      const res = await fetch("/api/quicklinks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ label: l, url: u, scope }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok: boolean; link?: Link; scope?: Scope; error?: string }
        | null;
      if (data?.ok && data.link) {
        if (data.scope === "team") setTeam((p) => [...(p ?? []), data.link!]);
        else setPersonal((p) => [...p, data.link!]);
        setLabel("");
        setUrl("");
        toast.success(`${data.link.label} added${data.scope === "team" ? " for the whole team" : ""}`);
      } else {
        toast.error(data?.error ?? "Failed to add link");
      }
    } catch {
      toast.error("Failed to add link — network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleRemove(link: Link, isTeam: boolean) {
    setBusyId(link.id);
    try {
      const res = await fetch(`/api/quicklinks/${link.id}`, { method: "DELETE" });
      const data = (await res.json().catch(() => null)) as { ok: boolean; error?: string } | null;
      if (data?.ok) {
        if (isTeam) setTeam((p) => (p ?? []).filter((x) => x.id !== link.id));
        else setPersonal((p) => p.filter((x) => x.id !== link.id));
        toast.info(`${link.label} removed`);
      } else {
        toast.error(data?.error ?? "Failed to remove link");
      }
    } catch {
      toast.error("Failed to remove link — network error");
    } finally {
      setBusyId(null);
    }
  }

  const inputCls =
    "rounded-lg border border-[#1A2235] bg-[#0F1420] px-3 py-2 text-sm text-[#E2E8F0] outline-none focus:border-[#2A3554]";

  const list = (links: Link[], isTeam: boolean) => (
    <ul className="mt-2 flex flex-col gap-2">
      {links.map((link) => (
        <li
          key={link.id}
          className="flex flex-wrap items-center gap-2.5 rounded-lg border border-[#1A2235] bg-[#0F1420] px-3 py-2 text-sm"
        >
          <span className="font-medium text-[#E2E8F0]">{link.label}</span>
          <a
            href={link.url}
            target="_blank"
            rel="noopener noreferrer"
            className="truncate text-xs text-[#5B6B8C] hover:text-[#93c5fd]"
          >
            {link.url.replace(/^https?:\/\//, "")}
          </a>
          {(!isTeam || admin) && (
            <span className="ml-auto">
              <button
                onClick={() => handleRemove(link, isTeam)}
                disabled={busyId === link.id}
                className={`rounded-md border border-[#3d2230] bg-[#151B2E] px-2.5 py-1 text-[11.5px] font-semibold text-[#F0A5B8] transition-colors hover:border-[#5A3040] hover:bg-[#2A1420] disabled:opacity-50 ${FOCUS_RING}`}
              >
                {busyId === link.id ? "…" : "Remove"}
              </button>
            </span>
          )}
        </li>
      ))}
    </ul>
  );

  return (
    <section>
      <h2 className="mb-1 text-sm font-semibold uppercase tracking-wide text-[#94A3B8]">Quicklinks</h2>
      <p className="mb-3 text-xs text-[#5B6B8C]">
        Links shown in the extension&apos;s Links tab. Team links show for everyone; personal links
        are just yours. Managed here — the extension picks them up automatically.
      </p>

      <div className="flex flex-wrap gap-2">
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" aria-label="Link label" className={`w-40 ${inputCls}`} />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleAdd()}
          placeholder="https://…"
          aria-label="Link URL"
          className={`min-w-[180px] flex-1 ${inputCls}`}
        />
        {admin && (
          <select value={scope} onChange={(e) => setScope(e.target.value as Scope)} aria-label="Link scope" className={inputCls}>
            <option value="personal">Just me</option>
            <option value="team">Whole team</option>
          </select>
        )}
        <button
          onClick={handleAdd}
          disabled={saving || !label.trim() || !url.trim()}
          className={`rounded-lg bg-[#FF3A69] px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-[#E02F5D] disabled:opacity-50 ${FOCUS_RING}`}
        >
          {saving ? "Adding…" : "Add link"}
        </button>
      </div>

      {team === null ? (
        <Skeleton className="mt-3 h-10 w-full bg-[#1E2640]" />
      ) : (
        <>
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-[#475569]">Team links</p>
          {team.length ? list(team, true) : <p className="mt-1 text-xs text-[#5B6B8C]">No team links yet.</p>}
          <p className="mt-4 text-[11px] font-semibold uppercase tracking-wide text-[#475569]">My links</p>
          {personal.length ? list(personal, false) : <p className="mt-1 text-xs text-[#5B6B8C]">No personal links yet.</p>}
        </>
      )}
    </section>
  );
}
