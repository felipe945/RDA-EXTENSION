# T3 — Dashboard UX: Missing Core Features
## Files Owned
- `components/Dashboard.tsx`
- `components/LeadCard.tsx`
- `components/AddLeadModal.tsx` (create new)

## Do NOT touch
- `hooks/useLeads.ts` (owned by T4)
- `app/page.tsx` — only change if you need to pass a prop
- `app/api/leads/route.ts` (owned by T4) — use the existing POST/PATCH endpoints as-is

---

## Context
The dashboard is the central daily surface. It currently has NO way to manually add a lead, NO text search, NO inline follow-up date setter, and NO undo when you accidentally move a stage. These are blockers for actual day-to-day use.

---

## FIX 1: Manual "Add Lead" Button + Modal
**Problem:** Zero UI to add a lead without the Chrome extension. All manual/LinkedIn/email leads have no entry point.  
**Location:** `components/Dashboard.tsx` — top of page, near pending-research banner

**Create `components/AddLeadModal.tsx`:**
```tsx
"use client";
import { useState } from "react";

const SOURCES = ["Manual", "IG", "LinkedIn", "Email", "SMS"];

export default function AddLeadModal({ onClose, onAdded }: {
  onClose: () => void;
  onAdded: () => void;
}) {
  const [form, setForm] = useState({
    ig_username: "", name: "", phone: "", email: "",
    linkedin_url: "", source: "Manual", notes: ""
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function set(key: string, val: string) {
    setForm(f => ({ ...f, [key]: val }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.ig_username && !form.name && !form.email && !form.phone) {
      setError("Need at least a name, IG username, email, or phone.");
      return;
    }
    setSaving(true);
    setError(null);
    const res = await fetch("/api/leads", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ig_username: form.ig_username || null,
        name: form.name || form.ig_username || null,
        phone: form.phone || null,
        email: form.email || null,
        linkedin_url: form.linkedin_url || null,
        source: form.source,
        mode: "sales",
        stage: "New",
        notes: form.notes || null,
        due_at: new Date(Date.now() + 48 * 3600000).toISOString(),
      }),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      setError((body as {error?:string}).error ?? "Failed to save.");
      setSaving(false);
      return;
    }
    setSaving(false);
    onAdded();
    onClose();
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />
      <div className="relative bg-gray-900 border border-gray-700 rounded-2xl p-6 w-full max-w-md mx-4 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-semibold text-white">Add Lead</h2>
          <button onClick={onClose} className="text-gray-500 hover:text-gray-300 text-xl leading-none">&times;</button>
        </div>

        <form onSubmit={submit} className="space-y-3">
          <Field label="IG Username" placeholder="@username" value={form.ig_username}
            onChange={v => set("ig_username", v.replace("@",""))} />
          <Field label="Full Name" placeholder="John Smith" value={form.name}
            onChange={v => set("name", v)} />
          <Field label="Email" placeholder="email@example.com" value={form.email}
            onChange={v => set("email", v)} type="email" />
          <Field label="Phone" placeholder="+1 (555) 000-0000" value={form.phone}
            onChange={v => set("phone", v)} />
          <Field label="LinkedIn URL" placeholder="https://linkedin.com/in/..." value={form.linkedin_url}
            onChange={v => set("linkedin_url", v)} />

          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide block mb-1">Source</label>
            <select
              value={form.source}
              onChange={e => set("source", e.target.value)}
              className="w-full text-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 outline-none"
            >
              {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>

          <div>
            <label className="text-xs text-gray-500 uppercase tracking-wide block mb-1">Notes</label>
            <textarea value={form.notes} onChange={e => set("notes", e.target.value)}
              rows={2} placeholder="How you know them, what they mentioned..."
              className="w-full text-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 outline-none resize-none" />
          </div>

          {error && <p className="text-xs text-red-400">{error}</p>}

          <button type="submit" disabled={saving}
            className="w-full py-2.5 bg-[#FF3A69] hover:bg-[#e03060] text-white font-semibold rounded-lg text-sm transition-colors disabled:opacity-50">
            {saving ? "Saving..." : "Add Lead"}
          </button>
        </form>
      </div>
    </div>
  );
}

function Field({ label, placeholder, value, onChange, type = "text" }: {
  label: string; placeholder: string; value: string;
  onChange: (v: string) => void; type?: string;
}) {
  return (
    <div>
      <label className="text-xs text-gray-500 uppercase tracking-wide block mb-1">{label}</label>
      <input type={type} placeholder={placeholder} value={value}
        onChange={e => onChange(e.target.value)}
        className="w-full text-sm bg-gray-800 border border-gray-700 rounded-lg px-3 py-2 text-gray-200 outline-none focus:border-gray-500" />
    </div>
  );
}
```

**In `components/Dashboard.tsx`:**
```tsx
import AddLeadModal from "@/components/AddLeadModal";

// Add state:
const [showAddLead, setShowAddLead] = useState(false);

// Add "+ Add Lead" button near the top (next to pending research banner OR as a floating button):
// Best UX: fixed bottom-right button
```

Add at the very end of the Dashboard return, before the closing `</div>`:
```tsx
{/* Floating Add Lead button */}
<button
  onClick={() => setShowAddLead(true)}
  className="fixed bottom-6 right-6 z-40 flex items-center gap-2 px-4 py-2.5 bg-[#FF3A69] hover:bg-[#e03060] text-white font-semibold rounded-full shadow-lg transition-colors text-sm"
>
  <span className="text-lg leading-none">+</span>
  Add Lead
</button>

{showAddLead && (
  <AddLeadModal
    onClose={() => setShowAddLead(false)}
    onAdded={async () => {
      // useLeads will auto-refresh via realtime — but force a refresh too
      // Dashboard doesn't have a refresh fn exposed; the realtime will catch it
    }}
  />
)}
```

---

## FIX 2: Client-Side Text Search
**Problem:** No way to find a specific lead. With 20+ leads, you need to type to filter.  
**Location:** `components/Dashboard.tsx` — add search input

```tsx
// Add state:
const [search, setSearch] = useState("");

// Add search filter after `sourceFiltered`:
const searchFiltered = search.trim()
  ? sourceFiltered.filter((l) => {
      const q = search.toLowerCase();
      return (
        l.ig_username?.toLowerCase().includes(q) ||
        l.name?.toLowerCase().includes(q) ||
        l.email?.toLowerCase().includes(q) ||
        l.phone?.includes(q) ||
        l.notes?.toLowerCase().includes(q)
      );
    })
  : sourceFiltered;

// Replace `sourceFiltered` → `searchFiltered` in all downstream uses
```

Add search input UI after the source tabs, before pipeline filter pills:
```tsx
{/* Search bar */}
<div className="relative">
  <input
    type="text"
    value={search}
    onChange={(e) => setSearch(e.target.value)}
    placeholder="Search leads by name, @handle, email..."
    className="w-full text-sm bg-gray-900 border border-gray-800 rounded-lg px-3 py-2 pl-8 text-gray-300 placeholder-gray-600 outline-none focus:border-gray-600"
  />
  <span className="absolute left-2.5 top-1/2 -translate-y-1/2 text-gray-600 text-sm">⌕</span>
  {search && (
    <button
      onClick={() => setSearch("")}
      className="absolute right-2.5 top-1/2 -translate-y-1/2 text-gray-600 hover:text-gray-300 text-sm"
    >✕</button>
  )}
</div>

{search && (
  <p className="text-xs text-gray-600">
    {searchFiltered.length} result{searchFiltered.length !== 1 ? "s" : ""} for "{search}"
  </p>
)}
```

---

## FIX 3: Inline Follow-Up Date Setter on LeadCard
**Problem:** `due_at` is set automatically (48h on save) but never adjustable from the dashboard. Felipe can't say "follow up in 3 days."  
**Location:** `components/LeadCard.tsx` — inside the expanded section

In the expanded LeadCard section (after the stage pills, before notes), add:
```tsx
{/* Follow-up date setter */}
<div className="flex items-center gap-2">
  <span className="text-xs text-gray-500">Follow up:</span>
  <div className="flex gap-1">
    {[1, 3, 7, 14].map(days => (
      <button
        key={days}
        onClick={async () => {
          const dueAt = new Date(Date.now() + days * 86400000).toISOString();
          await patchLead({ due_at: dueAt });
        }}
        className="text-xs px-2 py-0.5 border border-gray-700 rounded text-gray-500 hover:border-gray-500 hover:text-gray-300 transition-colors"
      >
        +{days}d
      </button>
    ))}
    <input
      type="date"
      onChange={async (e) => {
        if (!e.target.value) return;
        const dueAt = new Date(e.target.value).toISOString();
        await patchLead({ due_at: dueAt });
      }}
      className="text-xs bg-gray-800 border border-gray-700 rounded px-1.5 py-0.5 text-gray-500 outline-none cursor-pointer"
      title="Pick a specific date"
    />
  </div>
  {lead.due_at && (
    <button
      onClick={() => patchLead({ due_at: null })}
      className="text-xs text-gray-700 hover:text-gray-500"
      title="Clear due date"
    >clear</button>
  )}
</div>
```

---

## FIX 4: Stage Change Undo Toast on LeadCard
**Problem:** Clicking any stage pill is instant and permanent. A misclick loses the stage history.  
**Location:** `components/LeadCard.tsx` — `updateStage()` function

```tsx
// Add state:
const [undoStage, setUndoStage] = useState<{ prev: string; timer: ReturnType<typeof setTimeout> } | null>(null);

// Replace updateStage:
async function updateStage(stage: string) {
  if (undoStage) {
    clearTimeout(undoStage.timer);
    setUndoStage(null);
  }
  const prevStage = lead.stage;
  // Optimistic local update not needed — realtime will update
  await patchLead({ stage });

  const timer = setTimeout(() => setUndoStage(null), 3000);
  setUndoStage({ prev: prevStage, timer });
}

// Add undo button inside expanded section:
{undoStage && (
  <div className="flex items-center gap-2 text-xs animate-in fade-in">
    <span className="text-gray-500">Moved to {lead.stage}</span>
    <button
      onClick={async () => {
        clearTimeout(undoStage.timer);
        setUndoStage(null);
        await patchLead({ stage: undoStage.prev });
      }}
      className="text-[#FF3A69] font-medium hover:underline"
    >
      Undo
    </button>
  </div>
)}
```

Add cleanup on unmount:
```tsx
useEffect(() => {
  return () => { if (undoStage) clearTimeout(undoStage.timer); };
}, [undoStage]);
```

---

## FIX 5: Batch Research Button on Dashboard
**Problem:** No way to trigger AI research for all leads that have `research_status === "none"` at once.  
**Location:** `components/Dashboard.tsx` — pending research banner

Update the research banner to add a "Research All" button:
```tsx
{pendingResearch.length > 0 && (
  <div className="flex items-center justify-between bg-gray-900 border border-gray-800 rounded-lg px-4 py-3">
    <div className="flex items-center gap-3">
      <span className="w-2 h-2 rounded-full bg-[#FF3A69] animate-pulse shrink-0" />
      <span className="text-sm text-gray-300">
        <span className="font-medium text-white">{pendingResearch.length} leads</span> pending AI research
      </span>
    </div>
    <div className="flex gap-2">
      {/* NEW: Research All button for leads with status=none */}
      {leads.filter(l => l.research_status === "none").length > 0 && (
        <BatchResearchButton
          leads={leads.filter(l => l.research_status === "none")}
        />
      )}
      <Link href="/outreach" className="text-xs px-3 py-1.5 bg-[#FF3A69] text-white rounded-md font-medium hover:bg-[#e03060] transition-colors">
        Go to Outreach →
      </Link>
    </div>
  </div>
)}
```

Add `BatchResearchButton` component (can be in same file or in `AddLeadModal.tsx`):
```tsx
function BatchResearchButton({ leads }: { leads: Lead[] }) {
  const [running, setRunning] = useState(false);
  const [done, setDone] = useState(0);

  async function runAll() {
    setRunning(true);
    setDone(0);
    for (const lead of leads) {
      try {
        await fetch("/api/ai/research-lead", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId: lead.id }),
        });
      } catch {}
      setDone(d => d + 1);
    }
    setRunning(false);
  }

  return (
    <button
      onClick={runAll}
      disabled={running}
      className="text-xs px-3 py-1.5 border border-gray-700 rounded-md text-gray-400 hover:text-white hover:border-gray-500 transition-colors disabled:opacity-50"
    >
      {running ? `Researching ${done}/${leads.length}…` : `Research All (${leads.length})`}
    </button>
  );
}
```

---

## FIX 6: Research "Error" State Shows Retry in ResearchTab
**Problem:** `components/LeadDetailPanel.tsx` ResearchTab shows pending spinner but the error state doesn't show a retry button (currently the rest of the component was cut off in our read, but based on the structure, verify it has a retry for error state).

Read `components/LeadDetailPanel.tsx` lines 155-200 to check. If there's no retry button for `research_status === "error"`, add one:
```tsx
if (lead.research_status === "error") {
  return (
    <div className="py-8 space-y-3 text-center">
      <p className="text-sm text-red-400">Research failed.</p>
      <button
        onClick={triggerResearch}
        disabled={triggering}
        className="text-xs px-4 py-2 border border-red-800 rounded-lg text-red-400 hover:bg-red-900/20 transition-colors"
      >
        {triggering ? "Retrying..." : "Retry Research"}
      </button>
      {triggerError && <p className="text-xs text-red-600">{triggerError}</p>}
    </div>
  );
}
```

Also: The `triggerResearch` function calls `/api/ai/research-lead` but the route blocks if `research_status === "complete"`. For "error" state this is fine — the route only blocks on "complete". Verify `research_status === "error"` allows re-trigger (it should since the check is `if (lead.research_status === "complete") return 400`).

---

## FIX 7: "Replied" Stage Highlight — Make It More Visible
**Problem:** When someone replies to a DM, the card appears in the "upcoming" bucket without any visual urgency signal. "Replied" is the most important state — needs attention NOW.

**Location:** `components/LeadCard.tsx` + `components/Dashboard.tsx`

In `Dashboard.tsx` `urgencyBucket()`: bump "Replied" to "today" priority:
```typescript
function urgencyBucket(lead: Lead): UrgencyBucket {
  if (["Closed", "DQ", "Churned"].includes(lead.stage)) return "archived";
  if (["Booked", "Active"].includes(lead.stage)) return "booked";
  if (lead.stage === "Replied") return "today";   // ← ADD THIS LINE
  if (!lead.due_at) return "upcoming";
  // ... rest unchanged
}
```

In `LeadCard.tsx`, add a special "REPLIED" badge on the card header when stage is "Replied":
```tsx
{lead.stage === "Replied" && (
  <span className="text-xs font-bold text-white bg-[#8b5cf6] px-2 py-0.5 rounded-full animate-pulse shrink-0">
    REPLIED
  </span>
)}
```

---

## VERIFICATION
```
1. Click "+ Add Lead" button → modal opens, fill form → submit → lead appears in dashboard
2. Type in search bar → list filters in real-time, clears on ✕
3. Expand a LeadCard → +1d, +3d, +7d, +14d buttons appear → click one → due_at updates
4. Click a stage pill → undo toast appears → click Undo → stage reverts
5. Pending research banner shows "Research All (N)" button → click → all leads get queued
6. "Replied" leads appear in "Due Today" bucket with purple REPLIED badge
```

## COORDINATES WITH
- **T4**: `useLeads` realtime must fire after AddLeadModal submits (it will via Supabase realtime)
- **T4**: Batch research calls `/api/ai/research-lead` — T4's `force` flag allows re-research if needed
- **T6**: Nav notification dot needs a `repliedCount` — Dashboard already computes this; T6 can call `/api/notifications` instead
