# T2 — Outreach Queue + DM Integrity
## Files Owned
- `app/outreach/page.tsx`
- `app/api/messages/route.ts`
- `supabase/migrations/007_messages_sent_from.sql` (create this file)

## Do NOT touch
- `app/api/leads/route.ts` (owned by T4) — just change what you PUT IN the PATCH body
- `components/LeadCard.tsx` (owned by T3)

---

## Context
The outreach page is the highest-traffic daily workflow. Three categories of bugs:
1. **No undo** — marking DM Sent is instant, permanent, and irreversible from the outreach queue
2. **Wrong DM URL** — "Open IG + Copy" opens a profile page, not the DM compose window
3. **Messages written without sender identity** — `from_address`, `to_address` are always null; `dm_sent_at` is never set; email openers don't store subject separately

---

## FIX 1: Undo Toast After "DM Sent" (5-Second Grace Window)
**Problem:** `markStage("DM Sent")` immediately PATCHes the DB and writes a message record. No recovery.  
**Location:** `app/outreach/page.tsx` — `markStage()` function

**Fix:** Replace the immediate PATCH with a deferred approach:

```typescript
// Add to state at top of component:
const [pendingUndo, setPendingUndo] = useState<{
  lead: Lead; opener: string; note: string; timer: ReturnType<typeof setTimeout>
} | null>(null);

// Replace markStage("DM Sent") handler:
async function markSent() {
  if (!lead || saving || pendingUndo) return;
  
  const capturedLead = lead;
  const capturedOpener = opener;
  const capturedNote = note;
  
  // Advance the queue visually immediately
  setDoneCount((c) => c + 1);
  setNote("");
  setCopied(false);
  setIdx((i) => Math.min(i, Math.max(0, queued.length - 2)));

  // Start 5s undo window — actual PATCH fires on expiry
  const timer = setTimeout(async () => {
    setPendingUndo(null);
    const now = new Date().toISOString();
    const dueAt = new Date(Date.now() + 3 * 24 * 3600000).toISOString();
    setSaving("sent");
    await fetch("/api/leads", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id: capturedLead.id,
        stage: "DM Sent",
        last_contact_at: now,
        due_at: dueAt,
        dm_sent_at: now,          // ← new field
        updated_at: now,
      }),
    });
    if (capturedOpener || capturedNote) {
      await fetch("/api/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          lead_id: capturedLead.id,
          channel,
          direction: "outbound",
          body: [capturedOpener, capturedNote].filter(Boolean).join("\n\n---\n") || null,
          from_address: null,                   // T6 will wire active account here later
          to_address: capturedLead.ig_username
            ? `@${capturedLead.ig_username}`
            : capturedLead.email ?? capturedLead.phone ?? null,
          raw: channel === "email" && capturedLead.research_cache?.openers?.email
            ? capturedLead.research_cache.openers.email
            : null,
          created_at: now,
        }),
      });
    }
    setSaving(false);
    await refresh();
  }, 5000);

  setPendingUndo({ lead: capturedLead, opener: capturedOpener, note: capturedNote, timer });
}

function undoSent() {
  if (!pendingUndo) return;
  clearTimeout(pendingUndo.timer);
  setPendingUndo(null);
  setDoneCount((c) => Math.max(0, c - 1));
  setNote(pendingUndo.note);
  // Re-find the lead index to restore position
  const restoredIdx = queued.findIndex((l) => l.id === pendingUndo.lead.id);
  setIdx(restoredIdx >= 0 ? restoredIdx : 0);
}
```

Replace `markStage("DM Sent")` button handler to call `markSent()` instead.

Add undo toast UI at top level of the return (below the progress bar):
```tsx
{pendingUndo && (
  <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-gray-800 border border-gray-600 rounded-xl px-4 py-3 shadow-2xl">
    <span className="text-sm text-gray-200">
      DM logged for {pendingUndo.lead.ig_username ? `@${pendingUndo.lead.ig_username}` : "lead"}
    </span>
    <button
      onClick={undoSent}
      className="text-xs font-semibold text-[#FF3A69] hover:text-[#e03060] border border-[#FF3A69]/40 rounded-md px-3 py-1 transition-colors"
    >
      Undo
    </button>
    <span className="text-xs text-gray-600">5s</span>
  </div>
)}
```

Also clean up pending undo on unmount:
```typescript
useEffect(() => {
  return () => { if (pendingUndo) clearTimeout(pendingUndo.timer); };
}, [pendingUndo]);
```

**Update the ✓ DM Sent button** to call `markSent()`:
```tsx
<button
  onClick={markSent}
  disabled={!!saving || !!pendingUndo}
  className="..."
>
  {saving === "sent" ? "Saving..." : pendingUndo ? "Queued…" : "✓ DM Sent"}
</button>
```

---

## FIX 2: Correct DM URL — Open Instagram DM, Not Profile
**Problem:** `openProfile()` for IG channel opens `instagram.com/username/` (profile page). Felipe wants to land on the DM compose window.  
**Location:** `app/outreach/page.tsx` — `openProfile()` function

**Fix:** Change the IG case:
```typescript
function openProfile() {
  if (!lead) return;
  if (channel === "ig") {
    // instagram.com/direct/new/ with prefilled user starts a DM compose
    // Fallback: if direct URL doesn't work, open the profile
    const dmUrl = lead.ig_username
      ? `https://www.instagram.com/direct/t/${lead.ig_username}`
      : lead.ig_profile_url ?? `https://www.instagram.com/${lead.ig_username}/`;
    window.open(dmUrl, "_blank");
  } else if (channel === "linkedin" && lead.linkedin_url) {
    window.open(lead.linkedin_url, "_blank");
  } else if (channel === "email" && lead.email) {
    window.open(`mailto:${lead.email}?subject=${encodeURIComponent(
      (lead.research_cache?.openers?.email as {subject?:string})?.subject ?? ""
    )}`, "_blank");
  }
}
```
Note: `instagram.com/direct/t/USERNAME` opens an existing thread or starts a new one. This is the correct URL.

---

## FIX 3: Inline "Research Now" Trigger When No Opener
**Problem:** When a lead has no research data, the opener box shows "No opener yet — research this lead first" with no action button.  
**Location:** `app/outreach/page.tsx` — the empty opener block

**Fix:** Add a research trigger button inside the empty state:
```tsx
{/* Replace the existing no-opener div: */}
{!opener && (
  <div className="bg-gray-950 border border-gray-800 rounded-xl p-4 space-y-3">
    <p className="text-sm text-gray-600 text-center">
      {lead.research_status === "pending"
        ? "Opener generating... refresh in ~30s"
        : lead.research_status === "error"
        ? "Research failed."
        : "No opener yet."}
    </p>
    {(lead.research_status === "none" || lead.research_status === "error") && (
      <button
        onClick={async () => {
          await fetch("/api/ai/research-lead", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ leadId: lead.id, force: true }),
          });
          await refresh();
        }}
        className="w-full text-xs py-2 border border-gray-700 rounded-lg text-gray-400 hover:text-white hover:border-[#FF3A69] transition-colors"
      >
        Research this lead →
      </button>
    )}
  </div>
)}
```
Note: `force: true` flag — T4 must implement this in the research-lead route.

---

## FIX 4: DQ and Blocked Keep Working (no regression)
After adding `pendingUndo`, make sure DQ and Blocked still work immediately (no undo for those):

The existing `markStage("DQ")` and `markStage("Blocked")` should keep firing immediately. Only "DM Sent" gets the 5s window. Keep the `markStage` function as-is for DQ/Blocked, rename it to `markStageImmediate` if needed.

---

## FIX 5: Messages Migration — Add sent_from_handle Column
**Create file:** `supabase/migrations/007_messages_sent_from.sql`
```sql
-- Migration 007: Track which account sent each outbound DM
alter table messages
  add column if not exists sent_from_handle text;

-- Index for filtering by sender account
create index if not exists messages_sent_from_idx on messages (sent_from_handle)
  where sent_from_handle is not null;

comment on column messages.sent_from_handle is 
  'The IG/email/phone handle that sent this message (e.g. @fanbasisig). Set when DM Sent is marked.';
```
Run this in Supabase SQL Editor.

---

## FIX 6: messages route — support sent_from_handle in POST
**Location:** `app/api/messages/route.ts` — POST handler

The existing POST just does `db.from("messages").insert(body)` which accepts any columns. No code change needed — just ensure the outreach page passes `sent_from_handle` in the body once T1 provides `activeIgAccount`.

For now, set it to `null` — structure is in place for when T1 is done:
The POST body in `markSent()` already includes `from_address` and `to_address`. Add `sent_from_handle: null` as a placeholder so the column is populated in schema but empty until T1 wires account detection.

---

## VERIFICATION
```
1. Click "✓ DM Sent" on outreach page → undo toast appears, lead advances
2. Click "Undo" within 5s → lead restored, no PATCH sent
3. Wait 5s without clicking Undo → PATCH fires, lead stays advanced
4. "Open IG + Copy" for IG channel → opens instagram.com/direct/t/username (DM window)
5. Lead with no opener shows "Research this lead →" button
6. Clicking it triggers research and refreshes
7. DQ / Blocked still fire immediately (no undo window)
```

## COORDINATES WITH
- **T4**: Pass `force: true` in research-lead POST body — T4 must implement the force flag in the route
- **T4**: PATCH body now includes `dm_sent_at` — T4's PATCH handler must not strip unknown fields
- **T1**: Once T1 ships account detection, update `from_address` in messages POST to use `activeIgAccount` from context or a simple `localStorage.getItem('activeIgAccount')` bridge
