"use client";

import { useState } from "react";
import Link from "next/link";
import type { Lead } from "@/hooks/useLeads";
import { useAutoSave } from "@/hooks/useAutoSave";
import { type LeadPlus } from "@/components/ig";
import { STAGES, isKnownStage, stageColor } from "@/lib/stages";
import { TouchChips } from "@/components/TouchChips";
import { OwnerControl } from "@/components/OwnerControl";
import { SnoozeControl } from "@/components/SnoozeControl";
import ComposeEmail from "@/components/ComposeEmail";
import BookCallModal from "@/components/BookCallModal";

type Tab = "overview" | "research" | "history";

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

// ONE write path for every lead mutation: the /api/leads PATCH — same as the
// outreach card — so the server's claim-on-touch + owner stamping always fires.
// (Direct supabase writes from here used to bypass it.)
async function patchLead(id: string, fields: Record<string, unknown>) {
  await fetch("/api/leads", {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ id, ...fields, updated_at: new Date().toISOString() }),
  });
}

// ----------------------------------------------------------------
// Overview Tab
// ----------------------------------------------------------------
function OverviewTab({ lead: leadRaw }: { lead: Lead }) {
  const lead = leadRaw as LeadPlus;
  // Canonical stages only; a legacy/unknown stage shows as an extra chip so
  // it's visible without being an option we keep writing.
  const stages = isKnownStage(lead.stage) ? STAGES : [lead.stage, ...STAGES];
  const [notesValue, setNotesValue] = useState(lead.notes ?? "");
  const [bookMode, setBookMode] = useState<"book" | "availability" | null>(null);

  async function updateField(field: string, value: string) {
    await patchLead(lead.id, { [field]: value || null });
  }

  const { status: notesSaveStatus } = useAutoSave({
    data: notesValue,
    onSave: (val) => updateField("notes", val),
    delay: 1200,
  });

  return (
    <div className="space-y-5">
      {/* Ownership — hybrid model: DM Sent auto-claims; this is the admin
          reassign/release override (reps see the chip only). Realtime on the
          leads table refreshes this panel's `lead` prop after a change. */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Owner</p>
        <OwnerControl lead={lead} />
      </div>

      {/* Snooze — server-persisted, shared with the extension queue */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Snooze</p>
        <SnoozeControl lead={lead} />
      </div>

      {/* Two-touch: which IG accounts have touched this lead (written by the
          extension's FB / Pers. chips — read-only here) */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Touches</p>
        <TouchChips lead={lead} />
      </div>

      {/* Stage — advances automatically (send/reply/book/DQ); the quiet select
          is the rare manual override, not a chip wall. */}
      <div className="flex items-center gap-3">
        <p className="text-xs text-gray-500 uppercase tracking-wide">Stage</p>
        <span
          className="px-3 py-1 rounded-full text-xs font-medium border"
          style={{
            borderColor: `${stageColor(lead.stage)}66`,
            background: `${stageColor(lead.stage)}1a`,
            color: stageColor(lead.stage),
          }}
        >
          {lead.stage}
        </span>
        <select
          value={lead.stage}
          onChange={(e) => patchLead(lead.id, { stage: e.target.value })}
          aria-label="Change stage"
          className="ml-auto bg-transparent border border-[#1A2235] rounded-md text-xs text-[#475569] px-2 py-1 hover:border-[#2A3554] hover:text-[#94A3B8] focus:outline-none focus:border-[#3B82F6]"
        >
          {stages.map((s) => (
            <option key={s} value={s} className="bg-[#0F1420]">
              {s}
            </option>
          ))}
        </select>
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

      {/* Calendar CTAs — glance/offer times vs actually book */}
      <div className="flex gap-2">
        <button
          onClick={() => setBookMode("availability")}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all"
          style={{ background: '#151B2E', border: '1px solid #2A3554', color: '#94A3B8' }}
          onMouseEnter={e => { (e.currentTarget).style.borderColor = '#3B4A6E'; (e.currentTarget).style.color = '#E2E8F0'; }}
          onMouseLeave={e => { (e.currentTarget).style.borderColor = '#2A3554'; (e.currentTarget).style.color = '#94A3B8'; }}
        >
          🕐 See Availability
        </button>
        <button
          onClick={() => setBookMode("book")}
          className="flex-1 py-2.5 rounded-xl text-sm font-semibold flex items-center justify-center gap-2 transition-all"
          style={{ background: 'linear-gradient(135deg, #FF3A69, #c0294d)', color: 'white', boxShadow: '0 4px 16px rgba(255,58,105,0.25)' }}
          onMouseEnter={e => { (e.currentTarget).style.boxShadow = '0 6px 24px rgba(255,58,105,0.4)'; (e.currentTarget).style.transform = 'translateY(-1px)'; }}
          onMouseLeave={e => { (e.currentTarget).style.boxShadow = '0 4px 16px rgba(255,58,105,0.25)'; (e.currentTarget).style.transform = 'translateY(0)'; }}
        >
          📞 Book a Call
        </button>
      </div>

      {bookMode && (
        <BookCallModal
          lead={lead}
          mode={bookMode}
          onClose={() => setBookMode(null)}
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
      // force: also regenerate for off-type statuses (enriched*, error) —
      // every non-complete lead gets a working path to an opener.
      const res = await fetch("/api/ai/research-lead", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leadId: lead.id, force: true }),
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
                target={cp.url.startsWith("mailto:") ? "_self" : "_blank"}
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
      {(igOpener || openers?.email || openers?.linkedin) && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">AI Openers</p>
          <div className="space-y-2">
            {igOpener && <OpenerCard label="IG DM" text={igOpener} />}
            {openers?.linkedin && <OpenerCard label="LinkedIn" text={openers.linkedin} />}
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
// History Tab — the old "Outreach" (touchpoint logger) and "Activity"
// (IG event feed) tabs merged: log on top, feeds below. One place for
// everything that already happened with this lead.
// ----------------------------------------------------------------
type Touchpoint = {
  id: string;
  channel: string;
  result: string;
  note: string | null;
  tried_at: string;
};

type TouchChannel = { key: string; label: string; icon: string; ring: string };

const TOUCH_CHANNELS: TouchChannel[] = [
  { key: "ig_dm",       label: "IG DM",       icon: "📷", ring: "border-pink-700 text-pink-300 bg-pink-950/30" },
  { key: "ig_fanbasis", label: "IG FanBasis",  icon: "📸", ring: "border-pink-700 text-pink-300 bg-pink-950/30" },
  { key: "ig_personal", label: "IG Personal",  icon: "📷", ring: "border-purple-700 text-purple-300 bg-purple-950/30" },
  { key: "email",       label: "Email",        icon: "✉",  ring: "border-blue-700 text-blue-300 bg-blue-950/30" },
  { key: "linkedin",    label: "LinkedIn",     icon: "💼", ring: "border-sky-700 text-sky-300 bg-sky-950/30" },
  { key: "youtube",     label: "YouTube",      icon: "▶",  ring: "border-red-700 text-red-300 bg-red-950/30" },
  { key: "call",        label: "Call",         icon: "📞", ring: "border-yellow-700 text-yellow-300 bg-yellow-950/30" },
  { key: "loom",        label: "Loom",         icon: "🎥", ring: "border-purple-700 text-purple-300 bg-purple-950/30" },
];

const TOUCH_RESULTS = [
  { key: "sent",     label: "Sent",     dot: "bg-blue-500" },
  { key: "no_reply", label: "No Reply", dot: "bg-gray-500" },
  { key: "replied",  label: "Replied",  dot: "bg-green-500" },
  { key: "booked",   label: "Booked",   dot: "bg-[#ff0076]" },
  { key: "bounced",  label: "Bounced",  dot: "bg-red-500" },
];

function HistoryTab({ lead }: { lead: Lead }) {
  const [saving, setSaving] = useState(false);
  const [addingNote, setAddingNote] = useState<string | null>(null);
  const [noteText, setNoteText] = useState("");

  const touchpoints = (lead.outreach_log ?? []) as Touchpoint[];
  const sorted = [...touchpoints].sort(
    (a, b) => new Date(b.tried_at).getTime() - new Date(a.tried_at).getTime()
  );

  const tried    = new Set(touchpoints.map((t) => t.channel));
  const untried  = TOUCH_CHANNELS.filter((c) => !tried.has(c.key));
  const triedChs = TOUCH_CHANNELS.filter((c) => tried.has(c.key));

  const events = lead.ig_events ?? [];

  async function log(channel: string, result = "sent", note?: string) {
    setSaving(true);
    await fetch(`/api/leads/${lead.id}/touchpoints`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ channel, result, note: note || undefined }),
    });
    setSaving(false);
    setAddingNote(null);
    setNoteText("");
  }

  async function updateResult(touchpointId: string, result: string) {
    await fetch(`/api/leads/${lead.id}/touchpoints`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ touchpointId, result }),
    });
  }

  return (
    <div className="space-y-5">
      {/* Channel coverage bar */}
      <div>
        <div className="flex items-center justify-between mb-2">
          <p className="text-xs text-gray-500 uppercase tracking-wide">Coverage</p>
          <span className="text-xs text-gray-600">{tried.size}/{TOUCH_CHANNELS.length} channels</span>
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {TOUCH_CHANNELS.map((ch) => {
            const hit = tried.has(ch.key);
            const last = [...touchpoints].reverse().find((t) => t.channel === ch.key);
            const dot  = last ? TOUCH_RESULTS.find((r) => r.key === last.result)?.dot : undefined;
            return (
              <div
                key={ch.key}
                className={`flex items-center gap-1.5 px-2 py-1 rounded border text-xs ${
                  hit ? ch.ring : "border-gray-800 text-gray-600"
                }`}
              >
                <span>{ch.icon}</span>
                <span>{ch.label}</span>
                {hit && dot && <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${dot}`} />}
              </div>
            );
          })}
        </div>
      </div>

      {/* Log untried channel */}
      {untried.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Log outreach</p>
          <div className="flex gap-1.5 flex-wrap">
            {untried.map((ch) =>
              addingNote === ch.key ? (
                <div
                  key={ch.key}
                  className="flex items-center gap-1.5 bg-gray-900 border border-gray-600 rounded-lg px-2.5 py-1.5"
                >
                  <span>{ch.icon}</span>
                  <input
                    autoFocus
                    value={noteText}
                    onChange={(e) => setNoteText(e.target.value)}
                    placeholder="note (optional)"
                    className="bg-transparent text-xs text-gray-200 outline-none w-28 placeholder:text-gray-600"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") log(ch.key, "sent", noteText);
                      if (e.key === "Escape") setAddingNote(null);
                    }}
                  />
                  <button
                    onClick={() => log(ch.key, "sent", noteText)}
                    disabled={saving}
                    className="text-xs text-[#ff0076] hover:text-[#e0006a] font-medium"
                  >
                    Log
                  </button>
                </div>
              ) : (
                <button
                  key={ch.key}
                  onClick={() => { setAddingNote(ch.key); setNoteText(""); }}
                  disabled={saving}
                  className="flex items-center gap-1.5 px-3 py-1.5 border border-gray-700 rounded-lg text-xs text-gray-400 hover:border-gray-500 hover:text-gray-200 transition-colors disabled:opacity-40"
                >
                  <span>{ch.icon}</span>
                  <span>{ch.label}</span>
                </button>
              )
            )}
          </div>
        </div>
      )}

      {/* Re-try a tried channel */}
      {triedChs.length > 0 && (
        <div>
          <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">Log another attempt</p>
          <div className="flex gap-1.5 flex-wrap">
            {triedChs.map((ch) => (
              <button
                key={ch.key}
                onClick={() => log(ch.key)}
                disabled={saving}
                className={`flex items-center gap-1.5 px-3 py-1.5 border rounded-lg text-xs transition-colors disabled:opacity-40 ${ch.ring}`}
              >
                <span>{ch.icon}</span>
                <span>+ {ch.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Touchpoint timeline */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
          Outreach ({touchpoints.length})
        </p>
        {sorted.length === 0 ? (
          <p className="text-sm text-gray-600 py-6 text-center">
            No outreach logged yet — tap a channel above.
          </p>
        ) : (
          <div className="space-y-0">
            {sorted.map((tp) => {
              const ch = TOUCH_CHANNELS.find((c) => c.key === tp.channel);
              return (
                <div key={tp.id} className="flex items-center gap-3 py-2.5 border-b border-gray-800/60">
                  <span className="text-sm w-5 text-center shrink-0">{ch?.icon ?? "?"}</span>
                  <span className="text-xs text-gray-300 w-16 shrink-0">{ch?.label ?? tp.channel}</span>
                  <select
                    defaultValue={tp.result}
                    onChange={(e) => updateResult(tp.id, e.target.value)}
                    className="text-xs bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-300 outline-none cursor-pointer"
                  >
                    {TOUCH_RESULTS.map((r) => (
                      <option key={r.key} value={r.key}>{r.label}</option>
                    ))}
                  </select>
                  {tp.note && (
                    <span className="text-xs text-gray-600 flex-1 truncate italic">&ldquo;{tp.note}&rdquo;</span>
                  )}
                  <span className="text-xs text-gray-600 shrink-0 ml-auto">{relativeTime(tp.tried_at)}</span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* IG activity feed (from the Chrome extension) */}
      <div>
        <p className="text-xs text-gray-500 uppercase tracking-wide mb-2">
          IG Activity ({events.length})
        </p>
        {events.length === 0 ? (
          <p className="text-sm text-gray-600 py-6 text-center">
            No IG activity yet — events appear when the Chrome extension tracks interactions.
          </p>
        ) : (
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
        )}
      </div>
    </div>
  );
}

// ----------------------------------------------------------------
// LeadDetailPanel — exported default
// ----------------------------------------------------------------
export default function LeadDetailPanel({ lead }: { lead: Lead }) {
  const [tab, setTab] = useState<Tab>("overview");

  const historyCount = (lead.outreach_log ?? []).length + (lead.ig_events ?? []).length;

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "overview", label: "Overview" },
    { id: "research", label: "Research" },
    { id: "history",  label: "History", badge: historyCount || undefined },
  ];

  return (
    <div className="space-y-0">
      {/* Tab bar — 3 tabs; scripts live on /scripts, pre-filtered to this stage */}
      <div className="flex items-center border-b" style={{ borderColor: '#1A2235' }}>
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
        <Link
          href={`/scripts?stage=${encodeURIComponent(lead.stage)}`}
          className="ml-auto px-4 py-2 text-sm text-[#475569] hover:text-[#94A3B8] transition-colors"
        >
          Scripts →
        </Link>
      </div>

      {/* Tab content */}
      <div className="pt-5">
        {tab === "overview" && <OverviewTab lead={lead} />}
        {tab === "research" && <ResearchTab lead={lead} />}
        {tab === "history"  && <HistoryTab lead={lead} />}
      </div>
    </div>
  );
}
