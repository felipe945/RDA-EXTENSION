"use client";

import { useState } from "react";
import { supabase as getSupabase } from "@/lib/supabase";
import type { Lead } from "@/hooks/useLeads";
import { useAutoSave } from "@/hooks/useAutoSave";
import { useTeam } from "@/hooks/useTeam";
import { useToast } from "@/components/ui/toast";
import ScriptsVault from "@/components/ScriptsVault";
import ComposeEmail from "@/components/ComposeEmail";
import ComposeSMS from "@/components/ComposeSMS";
import TouchpointsTab from "@/components/TouchpointsTab";
import BookCallModal from "@/components/BookCallModal";

type Tab = "overview" | "research" | "scripts" | "activity" | "touchpoints";

const SALES_STAGES = ["New", "Warming", "DM Sent", "Replied", "Qualifying", "Call Offered", "Booked", "Closed", "DQ", "Blocked"];
const CSM_STAGES = ["Active", "At Risk", "Churned"];

function formatGmv(value: unknown): string {
  if (value == null) return "—";
  const num = typeof value === "number" ? value : Number(value);
  if (Number.isNaN(num)) return String(value);
  return `$${num.toLocaleString()}/mo est.`;
}

function fitScoreColor(score: number): string {
  if (score >= 70) return "bg-green-900/40 text-green-400 border-green-700";
  if (score >= 40) return "bg-yellow-900/40 text-yellow-400 border-yellow-700";
  return "bg-red-900/40 text-red-400 border-red-700";
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const h = Math.floor(diff / 3600000);
  if (h < 1) return `${Math.floor(diff / 60000)}m ago`;
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// ----------------------------------------------------------------
// Overview Tab
// ----------------------------------------------------------------
function OverviewTab({ lead }: { lead: Lead }) {
  const isSales = SALES_STAGES.includes(lead.stage);
  const stages = isSales ? SALES_STAGES : CSM_STAGES;
  const db = getSupabase();
  const { members } = useTeam();
  const toast = useToast();
  const [notesValue, setNotesValue] = useState(lead.notes ?? "");
  const [showBookCall, setShowBookCall] = useState(false);
  const [assigning, setAssigning] = useState(false);

  const currentAssignee = lead.assigned_to ?? "";

  // PATCH /api/leads/[id] is TEAM-T1's assignment entrypoint — it writes assignment_log
  // before updating. Realtime on the leads table refreshes this panel's `lead` prop.
  async function handleAssign(userId: string) {
    await fetch(`/api/leads/${lead.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ assigned_to: userId || null }),
    });
  }

  // assign-next already persists the pick + logs it server-side, so we don't re-PATCH here —
  // realtime reflects the change. It 409s when every rep is at capacity.
  async function handleAutoAssign() {
    setAssigning(true);
    try {
      const res = await fetch("/api/leads/assign-next", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id }),
      });
      const data = (await res.json().catch(() => ({}))) as { ok?: boolean; assignedTo?: string; error?: string };
      if (res.ok && data.ok) {
        const name = members.find((m) => m.userId === data.assignedTo)?.name;
        toast.success(name ? `Assigned to ${name}` : "Auto-assigned");
      } else {
        toast.error(data.error ?? "Couldn't auto-assign");
      }
    } catch {
      toast.error("Couldn't auto-assign");
    } finally {
      setAssigning(false);
    }
  }

  async function updateField(field: string, value: string) {
    await db
      .from("leads")
      .update({ [field]: value || null, updated_at: new Date().toISOString() })
      .eq("id", lead.id);
  }

  async function updateStage(stage: string) {
    await db
      .from("leads")
      .update({ stage, updated_at: new Date().toISOString() })
      .eq("id", lead.id);
  }

  const { status: notesSaveStatus } = useAutoSave({
    data: notesValue,
    onSave: (val) => updateField("notes", val),
    delay: 1200,
  });

  return (
    <div className="space-y-5">
      {/* Assignment */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Assigned to</p>
        <div className="flex items-center gap-2">
          <select
            value={currentAssignee}
            onChange={(e) => handleAssign(e.target.value)}
            className="rounded-lg border border-[#1A2235] bg-[#0F1420] px-2 py-1 text-xs text-[#E2E8F0] outline-none"
          >
            <option value="">Unassigned</option>
            {members.map((m) => (
              <option key={m.userId} value={m.userId}>{m.name}</option>
            ))}
          </select>
          <button
            onClick={handleAutoAssign}
            disabled={assigning}
            className="text-xs text-[#94A3B8] underline hover:text-[#E2E8F0] disabled:opacity-50"
          >
            {assigning ? "Assigning…" : "Auto-assign"}
          </button>
        </div>
      </div>

      {/* Stage selector */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Stage</p>
        <div className="flex gap-1.5 flex-wrap">
          {stages.map((s) => (
            <button
              key={s}
              onClick={() => updateStage(s)}
              className="px-3 py-1 rounded-full text-xs border transition-colors"
              style={
                lead.stage === s
                  ? { borderColor: '#3B82F6', background: 'rgba(59,130,246,0.12)', color: '#93C5FD' }
                  : { borderColor: '#1A2235', color: '#475569' }
              }
            >
              {s}
            </button>
          ))}
        </div>
      </div>

      {/* Editable fields */}
      <div className="space-y-3">
        <EditableField
          label="Phone"
          defaultValue={lead.phone ?? ""}
          onBlur={(v) => updateField("phone", v)}
          placeholder="+1 (555) 000-0000"
        />
        <EditableField
          label="Email"
          defaultValue={lead.email ?? ""}
          onBlur={(v) => updateField("email", v)}
          placeholder="you@example.com"
          type="email"
        />
        <EditableField
          label="LinkedIn"
          defaultValue={lead.linkedin_url ?? ""}
          onBlur={(v) => updateField("linkedin_url", v)}
          placeholder="https://linkedin.com/in/..."
        />
      </div>

      {/* Email compose */}
      {lead.email && (
        <ComposeEmail
          leadId={lead.id}
          to={lead.email}
          defaultSubject="Hey, quick question"
        />
      )}

      {/* SMS compose */}
      {lead.phone && (
        <ComposeSMS
          leadId={lead.id}
          to={lead.phone}
        />
      )}

      {/* Book a Call CTA */}
      <button
        onClick={() => setShowBookCall(true)}
        className="w-full py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all"
        style={{ background: 'linear-gradient(135deg, #FF3A69, #c0294d)', color: 'white', boxShadow: '0 4px 16px rgba(255,58,105,0.25)' }}
        onMouseEnter={e => { (e.currentTarget).style.boxShadow = '0 6px 24px rgba(255,58,105,0.4)'; (e.currentTarget).style.transform = 'translateY(-1px)'; }}
        onMouseLeave={e => { (e.currentTarget).style.boxShadow = '0 4px 16px rgba(255,58,105,0.25)'; (e.currentTarget).style.transform = 'translateY(0)'; }}
      >
        📞 Book a Call
      </button>

      {showBookCall && (
        <BookCallModal
          lead={lead}
          onClose={() => setShowBookCall(false)}
        />
      )}

      {/* Notes — auto-saves with debounce */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Notes</p>
          <span className={`text-xs transition-colors ${
            notesSaveStatus === "saving" ? "text-amber-500" :
            notesSaveStatus === "saved"  ? "text-green-500" :
            notesSaveStatus === "error"  ? "text-red-500"   :
            notesSaveStatus === "pending"? "text-gray-600"  : "text-transparent"
          }`}>
            {notesSaveStatus === "saving"  ? "Saving..." :
             notesSaveStatus === "saved"   ? "Saved" :
             notesSaveStatus === "error"   ? "Save failed" :
             notesSaveStatus === "pending" ? "Unsaved changes" : "·"}
          </span>
        </div>
        <textarea
          value={notesValue}
          onChange={(e) => setNotesValue(e.target.value)}
          rows={4}
          placeholder="Add notes..."
          className="w-full text-sm rounded-lg px-3 py-2 outline-none resize-none leading-relaxed transition-colors" style={{ background: '#0F1420', border: '1px solid #1A2235', color: '#CBD5E1' }}
        />
      </div>
    </div>
  );
}

function EditableField({
  label,
  defaultValue,
  onBlur,
  placeholder,
  type = "text",
}: {
  label: string;
  defaultValue: string;
  onBlur: (value: string) => void;
  placeholder?: string;
  type?: string;
}) {
  return (
    <div>
      <label className="text-xs text-gray-500 uppercase tracking-wide block mb-1">{label}</label>
      <input
        key={defaultValue}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        className="w-full text-sm rounded-lg px-3 py-2 outline-none transition-colors" style={{ background: '#0F1420', border: '1px solid #1A2235', color: '#CBD5E1' }}
        onBlur={(e) => onBlur(e.target.value)}
      />
    </div>
  );
}

// ----------------------------------------------------------------
// Research Tab
// ----------------------------------------------------------------
function ResearchTab({ lead }: { lead: Lead }) {
  const [triggering, setTriggering] = useState(false);
  const [triggerError, setTriggerError] = useState<string | null>(null);

  async function triggerResearch() {
    setTriggering(true);
    setTriggerError(null);
    try {
      const res = await fetch("/api/ai/research-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({})) as { error?: string };
        setTriggerError(body.error ?? `HTTP ${res.status}`);
      }
    } catch (err) {
      setTriggerError(err instanceof Error ? err.message : "Network error");
    } finally {
      setTriggering(false);
    }
  }

  if (lead.research_status === "pending") {
    return (
      <div className="flex items-center gap-3 py-12">
        <span className="w-2.5 h-2.5 rounded-full bg-amber-500 animate-pulse shrink-0" />
        <span className="text-sm text-amber-400">Researching profile...</span>
      </div>
    );
  }

  if (lead.research_status === "error") {
    return (
      <div className="py-8 space-y-3">
        <div className="flex items-center gap-2 text-red-400 text-sm">
          <span className="text-base">!</span>
          <span>Research failed</span>
        </div>
        <p className="text-xs text-gray-600">The AI research job encountered an error.</p>
        <button
          onClick={triggerResearch}
          disabled={triggering}
          className="px-4 py-1.5 text-sm rounded-md border border-red-700 text-red-400 hover:bg-red-900/20 transition-colors disabled:opacity-40"
        >
          {triggering ? "Retrying..." : "Retry Research"}
        </button>
        {triggerError && <p className="text-xs text-red-500">{triggerError}</p>}
      </div>
    );
  }

  if (lead.research_status !== "complete" || !lead.research_cache) {
    return (
      <div className="py-12 text-center space-y-4">
        <p className="text-sm text-gray-600">No research yet.</p>
        <button
          onClick={triggerResearch}
          disabled={triggering}
          className="px-5 py-2 rounded-md text-sm font-medium bg-[#ff0076] hover:bg-[#e0006a] text-white transition-colors disabled:opacity-50"
        >
          {triggering ? "Starting..." : "Research Now"}
        </button>
        {triggerError && <p className="text-xs text-red-500 mt-2">{triggerError}</p>}
      </div>
    );
  }

  const c = lead.research_cache;
  const fitScore        = typeof c.fitScore === "number" ? c.fitScore : null;
  const estimatedGmv   = c.estimatedGmv;
  const stackDetected  = Array.isArray(c.stackDetected) ? (c.stackDetected as string[]) : [];
  const summary        = typeof c.summary === "string" ? c.summary : null;
  const persona        = typeof c.persona === "string" ? c.persona : null;
  const fitReason      = typeof c.fitReason === "string" ? c.fitReason : null;
  const alreadyCustomer = Boolean(c.alreadyCustomer);

  const handles = c.inferredHandles as Record<string, string | null> | null | undefined;
  const openers = c.openers as {
    ig?: string;
    email?: { subject?: string; body?: string };
    linkedin?: string;
    sms?: string;
  } | null | undefined;

  const igOpener = openers?.ig ?? (typeof c.suggestedOpener === "string" ? c.suggestedOpener : null);

  // Build full contact map: known fields + inferred handles
  type ContactPoint = { label: string; icon: string; url: string; handle: string };
  const contacts: ContactPoint[] = [];

  if (lead.ig_username) contacts.push({
    label: "Instagram",
    icon: "📷",
    url: `https://www.instagram.com/${lead.ig_username}/`,
    handle: `@${lead.ig_username}`,
  });
  if (lead.email) contacts.push({
    label: "Email",
    icon: "✉",
    url: `mailto:${lead.email}`,
    handle: lead.email,
  });
  if (lead.phone) contacts.push({
    label: "SMS",
    icon: "💬",
    url: `sms:${lead.phone}`,
    handle: lead.phone,
  });
  if (lead.linkedin_url) contacts.push({
    label: "LinkedIn",
    icon: "💼",
    url: lead.linkedin_url,
    handle: lead.linkedin_url.replace(/^https?:\/\/(www\.)?linkedin\.com\/in\//, "").replace(/\/$/, ""),
  });

  // Append inferred handles from Gemini, converted to real URLs
  if (handles) {
    if (handles.youtube) {
      const h = handles.youtube;
      const url = h.startsWith("http") ? h : `https://youtube.com/${h.startsWith("@") ? h : "@" + h}`;
      contacts.push({ label: "YouTube", icon: "▶", url, handle: h });
    }
    if (handles.twitter) {
      const h = handles.twitter.replace(/^@/, "");
      contacts.push({ label: "Twitter / X", icon: "𝕏", url: `https://x.com/${h}`, handle: `@${h}` });
    }
    if (handles.website) {
      const url = handles.website.startsWith("http") ? handles.website : `https://${handles.website}`;
      contacts.push({ label: "Website", icon: "🌐", url, handle: handles.website });
    }
    if (handles.email && !lead.email) {
      contacts.push({ label: "Email", icon: "✉", url: `mailto:${handles.email}`, handle: handles.email });
    }
  }

  return (
    <div className="space-y-4">
      {alreadyCustomer && (
        <div className="rounded-xl px-4 py-3 text-sm" style={{ background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.25)', color: '#93C5FD' }}>
          Already a customer — check CRM before outreach.
        </div>
      )}

      {/* Quick reach — all contact points as clickable links */}
      {contacts.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Quick Reach</p>
          <div className="flex flex-col gap-1.5">
            {contacts.map((cp) => (
              <a
                key={cp.label}
                href={cp.url}
                target={cp.url.startsWith("mailto:") || cp.url.startsWith("sms:") ? "_self" : "_blank"}
                rel="noopener noreferrer"
                className="flex items-center gap-3 px-3 py-2 rounded-xl transition-colors group cursor-pointer" style={{ background: '#0F1420', border: '1px solid #1A2235' }} onMouseEnter={(e)=>(e.currentTarget.style.borderColor='#2A3554')} onMouseLeave={(e)=>(e.currentTarget.style.borderColor='#1A2235')}
              >
                <span className="text-base w-5 text-center shrink-0">{cp.icon}</span>
                <span className="text-xs text-gray-400 w-20 shrink-0">{cp.label}</span>
                <span className="text-xs text-gray-200 truncate flex-1 group-hover:text-white">{cp.handle}</span>
                <span className="text-xs text-gray-600 group-hover:text-[#ff0076] shrink-0">→</span>
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Core scores */}
      <div className="space-y-0">
        {fitScore != null && (
          <ResearchRow label="Fit Score">
            <span className={`text-xs px-2.5 py-1 rounded-full border font-semibold ${fitScoreColor(fitScore)}`}>
              {fitScore}/100
            </span>
          </ResearchRow>
        )}
        {estimatedGmv != null && (
          <ResearchRow label="Est. GMV">
            <span className="text-sm text-gray-200">{formatGmv(estimatedGmv)}</span>
          </ResearchRow>
        )}
        {persona && (
          <ResearchRow label="Persona">
            <span className="text-xs px-2 py-0.5 bg-purple-900/40 border border-purple-700 rounded text-purple-300">
              {persona}
            </span>
          </ResearchRow>
        )}
        {stackDetected.length > 0 && (
          <ResearchRow label="Stack">
            <div className="flex gap-1.5 flex-wrap justify-end">
              {stackDetected.map((tag) => (
                <span key={tag} className="text-xs px-2 py-0.5 bg-gray-800 border border-gray-700 rounded text-gray-300">
                  {tag}
                </span>
              ))}
            </div>
          </ResearchRow>
        )}
      </div>

      {/* Summary + fit reason */}
      {summary && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Summary</p>
          <p className="text-sm text-gray-300 leading-relaxed bg-gray-900/60 p-3 rounded-lg">{summary}</p>
        </div>
      )}
      {fitReason && (
        <p className="text-xs text-gray-600 italic leading-relaxed">{fitReason}</p>
      )}

      {/* Per-channel AI openers */}
      {(igOpener || openers?.email || openers?.linkedin || openers?.sms) && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">AI Openers</p>
          <div className="space-y-2">
            {igOpener && <OpenerCard label="IG DM" text={igOpener} />}
            {openers?.linkedin && <OpenerCard label="LinkedIn" text={openers.linkedin} />}
            {openers?.sms && <OpenerCard label="SMS" text={openers.sms} />}
            {openers?.email && (
              <div className="bg-gray-900/60 border border-gray-800 rounded-lg p-3 space-y-2">
                <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Email</span>
                {openers.email.subject && (
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs text-gray-600 shrink-0">Subject:</span>
                    <span className="text-xs text-gray-300 flex-1 text-right truncate">{openers.email.subject}</span>
                    <button
                      onClick={() => navigator.clipboard.writeText(openers!.email!.subject!)}
                      className="text-xs px-1.5 py-0.5 border border-gray-800 rounded text-gray-600 hover:text-gray-300 hover:border-gray-600 transition-colors shrink-0"
                    >
                      Copy
                    </button>
                  </div>
                )}
                {openers.email.body && (
                  <div>
                    <p className="text-xs text-gray-300 leading-relaxed">{openers.email.body}</p>
                    <button
                      onClick={() => navigator.clipboard.writeText(openers!.email!.body!)}
                      className="mt-2 text-xs px-2 py-0.5 border border-gray-800 rounded text-gray-600 hover:text-gray-300 hover:border-gray-600 transition-colors"
                    >
                      Copy body
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function OpenerCard({ label, text }: { label: string; text: string }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    navigator.clipboard.writeText(text);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  }
  return (
    <div className="relative rounded-xl p-3" style={{ background: '#0F1420', border: '1px solid #1A2235' }}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">{label}</span>
        <button
          onClick={copy}
          className={`text-xs px-2 py-0.5 border rounded transition-colors ${
            copied
              ? "border-green-700 text-green-400"
              : "border-gray-800 text-gray-600 hover:text-gray-300 hover:border-gray-600"
          }`}
        >
          {copied ? "Copied!" : "Copy"}
        </button>
      </div>
      <p className="text-sm text-gray-200 leading-relaxed">{text}</p>
    </div>
  );
}

function ResearchRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between py-2.5 border-b border-gray-800">
      <span className="text-xs text-gray-500">{label}</span>
      {children}
    </div>
  );
}

// ----------------------------------------------------------------
// Activity Tab
// ----------------------------------------------------------------
function ActivityTab({ lead }: { lead: Lead }) {
  const events = lead.ig_events ?? [];

  if (events.length === 0) {
    return (
      <div className="py-12 text-center">
        <p className="text-sm text-gray-600">No IG activity logged yet.</p>
        <p className="text-xs text-gray-700 mt-1">
          Events will appear when the Chrome extension tracks interactions.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-0">
      {[...events].reverse().map((ev, i) => (
        <div
          key={i}
          className="flex items-center gap-3 py-2.5 border-b border-gray-800/60 text-sm"
        >
          <span className="text-xs text-gray-600 w-24 shrink-0">
            {new Date(ev.ts).toLocaleDateString()}
          </span>
          <span className="text-gray-300 capitalize flex-1">{ev.type}</span>
          <span className="text-xs text-gray-600 shrink-0">{relativeTime(ev.ts)}</span>
          {ev.postUrl && (
            <a
              href={ev.postUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="text-xs text-blue-500 hover:underline shrink-0"
            >
              post &rarr;
            </a>
          )}
        </div>
      ))}
    </div>
  );
}

// ----------------------------------------------------------------
// LeadDetailPanel — exported default
// ----------------------------------------------------------------
export default function LeadDetailPanel({ lead }: { lead: Lead }) {
  const [tab, setTab] = useState<Tab>("overview");

  const touchpointCount = (lead.outreach_log ?? []).length;

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "overview",    label: "Overview" },
    { id: "touchpoints", label: "Outreach", badge: touchpointCount || undefined },
    { id: "scripts",     label: "Scripts" },
    { id: "research",    label: "Research" },
    { id: "activity",    label: "Activity" },
  ];

  return (
    <div className="space-y-0">
      {/* Tab bar */}
      <div className="flex border-b" style={{ borderColor: '#1A2235' }}>
        {tabs.map(({ id: tabId, label, badge }) => (
          <button
            key={tabId}
            onClick={() => setTab(tabId)}
            className={`px-4 py-2 text-sm border-b-2 -mb-px transition-colors flex items-center gap-1.5 ${
              tab === tabId
                ? "text-blue-400"
                : "border-transparent text-[#475569] hover:text-[#94A3B8]"
            }`}
            style={tab === tabId ? { borderColor: '#3B82F6', borderBottomWidth: '2px' } : undefined}
          >
            {label}
            {badge !== undefined && (
              <span className="text-xs bg-gray-700 text-gray-300 px-1.5 py-0.5 rounded-full leading-none">
                {badge}
              </span>
            )}
            {tabId === "research" && lead.research_status === "pending" && (
              <span className="w-1.5 h-1.5 rounded-full bg-amber-500 animate-pulse" />
            )}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="pt-5">
        {tab === "overview"    && <OverviewTab lead={lead} />}
        {tab === "touchpoints" && <TouchpointsTab lead={lead} />}
        {tab === "scripts"     && (
          <ScriptsVault
            leadStage={lead.stage}
            leadName={lead.name ?? lead.ig_username ?? undefined}
            compact
          />
        )}
        {tab === "research"    && <ResearchTab lead={lead} />}
        {tab === "activity"    && <ActivityTab lead={lead} />}
      </div>
    </div>
  );
}
