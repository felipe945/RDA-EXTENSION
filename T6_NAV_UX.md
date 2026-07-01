# T6 — Nav, Notifications, Inbox, Summary & Lead Detail
## Files Owned
- `components/Nav.tsx`
- `app/summary/page.tsx`
- `app/inbox/page.tsx`
- `app/leads/[id]/page.tsx`

## Do NOT touch
- `components/Dashboard.tsx` (owned by T3)
- `hooks/useLeads.ts` (owned by T4)
- `app/api/*` routes (owned by T4/T5)

---

## Context
The nav has no notification indicators — Felipe can't tell at a glance that follow-ups are overdue or someone replied. The summary page has a stale "T3 coming soon" warning that was never removed (T3 IS built). The inbox crashes on null lead_id and doesn't filter by mode. The lead detail back button works (uses `router.back()`) but loses context when navigating from external links.

---

## FIX 1: Nav — Active State + Overdue/Replied Notification Dot
**Problem:** Nav doesn't show which page is active (it does highlight — verified in code — but Inbox has no badge showing unread count or overdue count).  
**Location:** `components/Nav.tsx`

The Nav already uses `usePathname()` for active state. Good.

**Add notification data:** Fetch a lightweight count from `/api/notifications` on mount:

```tsx
"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useMode } from "@/components/ModeProvider";
import { useSession, signIn, signOut } from "next-auth/react";
import { useEffect, useState } from "react";

type NotifCounts = { overdue: number; replied: number; unread: number };

export default function Nav() {
  const pathname = usePathname();
  const { mode, setMode } = useMode();
  const { data: session } = useSession();
  const [counts, setCounts] = useState<NotifCounts>({ overdue: 0, replied: 0, unread: 0 });

  useEffect(() => {
    async function loadCounts() {
      try {
        const res = await fetch(`/api/notifications?mode=${mode}`);
        if (!res.ok) return;
        const { overdue = [], notifications = [] } = await res.json() as {
          overdue?: unknown[];
          notifications?: unknown[];
        };
        const unread = notifications.filter((n: unknown) => {
          const notif = n as { type?: string };
          return notif.type?.endsWith("_reply") || notif.type === "replied";
        }).length;
        const repliedNotifs = notifications.filter((n: unknown) => {
          const notif = n as { type?: string };
          return notif.type === "replied" || notif.type === "ig_reply";
        }).length;
        setCounts({
          overdue: (overdue as unknown[]).length,
          replied: repliedNotifs,
          unread,
        });
      } catch {}
    }

    loadCounts();
    const interval = setInterval(loadCounts, 60_000); // refresh counts every 60s
    return () => clearInterval(interval);
  }, [mode]);

  const urgentCount = counts.overdue + counts.replied;

  return (
    <header className="sticky top-0 z-10 flex items-center justify-between px-6 py-3 border-b border-gray-800 bg-gray-950">
      <div className="flex items-center gap-5">
        <span className="font-semibold text-sm tracking-tight text-white">Unified Sales Ops</span>
        <nav className="flex items-center gap-0.5">
          {NAV_LINKS.map(({ href, label }) => {
            const isActive = pathname === href || (href !== "/" && pathname.startsWith(href));
            
            // Add badge to specific nav items
            const badge =
              href === "/" && urgentCount > 0 ? urgentCount :
              href === "/inbox" && counts.unread > 0 ? counts.unread :
              null;

            return (
              <Link
                key={href}
                href={href}
                className={`relative px-3 py-1.5 rounded-md text-sm transition-colors ${
                  isActive
                    ? "bg-gray-800 text-white"
                    : "text-gray-400 hover:text-gray-200 hover:bg-gray-900"
                }`}
              >
                {label}
                {badge !== null && (
                  <span className="absolute -top-0.5 -right-0.5 min-w-[16px] h-4 px-1 text-[10px] font-bold bg-[#FF3A69] text-white rounded-full flex items-center justify-center leading-none">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>

      {/* ... rest of Nav (mode toggle, Gmail) unchanged ... */}
      <div className="flex items-center gap-3">
        {session?.access_token ? (
          <div className="flex items-center gap-2">
            <span className="text-xs text-green-400">✉ Gmail</span>
            <button onClick={() => signOut()} className="text-xs text-gray-600 hover:text-gray-400">
              sign out
            </button>
          </div>
        ) : (
          <button
            onClick={() => signIn("google")}
            className="text-xs px-2.5 py-1 border border-gray-700 rounded-md text-gray-400 hover:text-white hover:border-gray-500 transition-colors"
          >
            Connect Gmail
          </button>
        )}
        <div className="flex items-center gap-1 bg-gray-900 rounded-lg p-1">
          <button
            onClick={() => setMode("sales")}
            className={`px-4 py-1 rounded-md text-xs font-medium transition-colors ${
              mode === "sales" ? "bg-blue-600 text-white" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            Sales
          </button>
          <button
            onClick={() => setMode("csm")}
            className={`px-4 py-1 rounded-md text-xs font-medium transition-colors ${
              mode === "csm" ? "bg-purple-600 text-white" : "text-gray-400 hover:text-gray-200"
            }`}
          >
            CSM
          </button>
        </div>
      </div>
    </header>
  );
}
```

---

## FIX 2: Summary Page — Remove Stale T3 Warning + Better Rendering
**Problem 1:** `app/summary/page.tsx` `FallbackBriefing` has a hardcoded amber warning: `"AI briefing will appear here once /api/ai/summary is live (T3). Showing live data below."` — T3 IS LIVE.  
**Problem 2:** AI briefing is rendered in `<pre>` tags — it shows as a wall of monospace text, not readable.

**Fix 1 — Remove the stale warning:**  
In `app/summary/page.tsx`, find the `FallbackBriefing` component and remove the warning div entirely:
```tsx
// DELETE this block:
<div className="text-xs text-amber-600 bg-amber-900/20 border border-amber-800/40 rounded px-3 py-2">
  AI briefing will appear here once /api/ai/summary is live (T3). Showing live data below.
</div>
```

**Fix 2 — Better AI content rendering:**
Replace the `<pre>` rendering in the `ai` status block with a more readable format:
```tsx
{state.status === "ai" && (
  <div className="space-y-4">
    <div className="flex items-center justify-between">
      <span className="text-xs text-gray-600">
        Generated {new Date(state.generatedAt).toLocaleTimeString()}
      </span>
      <button
        onClick={() => setState({ status: "loading" })}
        className="text-xs text-gray-500 hover:text-gray-300 border border-gray-800 rounded px-2 py-0.5"
        // Note: this doesn't actually refresh — add a proper refresh:
        // onClick={() => { setState({ status: "loading" }); load(); }}
      >
        Refresh
      </button>
    </div>
    <div className="space-y-1">
      {state.content.split("\n").map((line, i) => {
        if (!line.trim()) return <div key={i} className="h-2" />;
        const isHeading = /^\d+\./.test(line) || line.endsWith(":");
        return (
          <p
            key={i}
            className={`text-sm leading-relaxed ${
              isHeading ? "font-semibold text-white mt-3" : "text-gray-300"
            }`}
          >
            {line}
          </p>
        );
      })}
    </div>
  </div>
)}
```

Also add a proper refresh function:
```tsx
const [refreshing, setRefreshing] = useState(false);

async function refreshBriefing() {
  setRefreshing(true);
  setState({ status: "loading" });
  await load();
  setRefreshing(false);
}
```

Wire the Refresh button to `onClick={() => refreshBriefing()}`.

**Fix 3 — Cache briefing in sessionStorage** so it doesn't re-generate on every page visit:
```tsx
useEffect(() => {
  async function load() {
    setState({ status: "loading" });

    // Check sessionStorage cache (briefings are generated for the day — valid for 1 hour)
    const cacheKey = `briefing-${mode}-${new Date().toDateString()}`;
    const cached = sessionStorage.getItem(cacheKey);
    if (cached) {
      try {
        const parsed = JSON.parse(cached) as { content: string; generatedAt: string; ts: number };
        if (Date.now() - parsed.ts < 3600_000) {  // 1 hour
          setState({ status: "ai", content: parsed.content, generatedAt: parsed.generatedAt });
          return;
        }
      } catch {}
    }

    // Fetch from AI endpoint
    try {
      const res = await fetch(`/api/ai/summary?mode=${mode}`);
      if (res.ok) {
        const data = await res.json() as { content?: string; generatedAt?: string };
        if (data.content) {
          const entry = { content: data.content, generatedAt: data.generatedAt ?? new Date().toISOString(), ts: Date.now() };
          sessionStorage.setItem(cacheKey, JSON.stringify(entry));
          setState({ status: "ai", content: data.content, generatedAt: entry.generatedAt });
          return;
        }
      }
    } catch {}

    // Fallback to live Supabase data
    // ... existing fallback code ...
  }
  load();
}, [mode]);
```

---

## FIX 3: Inbox — Mode Filter + Null Lead Fix + Mark All Read
**Problem 1:** Inbox queries `messages` table via Supabase anon key directly (not through an API route). The join `.select("*, leads(name, ig_username)")` filters messages but not by `leads.mode`. CSM messages appear in Sales inbox and vice versa.  
**Problem 2:** When `lead_id` is null, the inbox renders `<Link href="/leads/null">` — navigates to a broken page.  
**Problem 3:** No "Mark all read" button.

**Location:** `app/inbox/page.tsx`

**Fix 1 — Mode filter via API route instead of direct Supabase:**

Replace the direct Supabase query with a fetch to `/api/notifications` (which already filters by mode) OR add a new API endpoint. Simplest fix: add mode filter to the existing Supabase query via the join:

```typescript
// In the load() function, replace the query:
const { data, error } = await db
  .from("messages")
  .select("*, leads!inner(id, name, ig_username, mode)")  // ← use !inner to filter nulls
  .eq("direction", "inbound")
  .eq("leads.mode", mode)          // ← filter by mode via join
  .order("created_at", { ascending: false })
  .limit(100);
```

Note: `.eq("leads.mode", mode)` on a join requires Supabase's PostgREST filter syntax. If this doesn't work with the anon key due to RLS, T5's RLS fix will resolve it.

**Fix 2 — Null lead_id:**

In the message rendering, guard against null lead_id:
```tsx
// Replace the Link wrapping the sender name:
{msg.lead_id ? (
  <Link href={`/leads/${msg.lead_id}`} className="text-sm font-medium hover:text-blue-400 truncate">
    {sender}
  </Link>
) : (
  <span className="text-sm font-medium text-gray-400 truncate">{sender}</span>
)}

// Replace the "View lead →" link at the bottom:
{msg.lead_id && (
  <Link href={`/leads/${msg.lead_id}`} className="text-xs text-blue-500 hover:underline">
    View lead →
  </Link>
)}
```

Also fix the unknown sender fallback:
```typescript
const sender = msg.ig_username ? `@${msg.ig_username}` : (msg.lead_name ?? "Unknown sender");
```

**Fix 3 — Mark All Read:**
```tsx
// Add function:
async function markAllRead() {
  const unreadIds = messages.filter(m => !m.read).map(m => m.id);
  if (!unreadIds.length) return;
  
  // Update all in one Supabase call
  await getSupabase()
    .from("messages")
    .update({ read: true })
    .in("id", unreadIds);
  
  setMessages(prev => prev.map(m => ({ ...m, read: true })));
}

// Add button next to filter tabs:
{unreadCount > 0 && (
  <button
    onClick={markAllRead}
    className="text-xs text-gray-500 hover:text-gray-300 border border-gray-800 rounded px-2 py-1 transition-colors"
  >
    Mark all read ({unreadCount})
  </button>
)}
```

**Fix 4 — Add direction filter tabs (Inbound / Outbound / All):**
The inbox currently only shows inbound. Add an "Outbound" tab to see the messages YOU sent (useful for history):
```tsx
const [direction, setDirection] = useState<"inbound" | "outbound" | "all">("inbound");

// Update the Supabase query:
let query = db
  .from("messages")
  .select("*, leads!inner(id, name, ig_username, mode)")
  .eq("leads.mode", mode)
  .order("created_at", { ascending: false })
  .limit(100);

if (direction !== "all") {
  query = query.eq("direction", direction);
}
```

Add direction tabs to the header:
```tsx
<div className="flex gap-1">
  {(["inbound", "outbound", "all"] as const).map(d => (
    <button key={d} onClick={() => setDirection(d)}
      className={`px-3 py-1 rounded-md text-xs transition-colors ${
        direction === d ? "bg-gray-700 text-white" : "text-gray-500 hover:text-gray-300"
      }`}>
      {d === "inbound" ? "Received" : d === "outbound" ? "Sent" : "All"}
    </button>
  ))}
</div>
```

---

## FIX 4: Lead Detail Page — Fix Back Navigation Context
**Problem:** `app/leads/[id]/page.tsx` uses `router.back()` — this is CORRECT (already uses `router.back()`, not a hardcoded `/`). The memory said it was broken but the code shows it's fine.

**Verify:** The file reads `onClick={() => router.back()}` with `import { useRouter } from "next/navigation"`. This is correct — it respects navigation history. No change needed.

**However:** Add a fallback for when there's no history (direct URL access):
```tsx
// Replace the back button:
<button
  onClick={() => {
    if (window.history.length > 1) {
      router.back();
    } else {
      router.push("/");
    }
  }}
  className="text-gray-500 hover:text-gray-300 text-sm shrink-0 transition-colors"
  aria-label="Go back"
>
  &larr;
</button>
```

---

## FIX 5: Page Title Shows Overdue Count
When Felipe has overdue leads, the browser tab should show it so he notices even when the tab is in the background.

Add this to `app/page.tsx` (or wrap it — but `app/page.tsx` is minimal and T6 can add a client-side effect):

Actually, add it to the `Dashboard.tsx` component header area (T3 owns that), so coordinate:

**T3 coordination note:** In `components/Dashboard.tsx`, add this effect in the component:
```typescript
// In Dashboard component, after computing needsFUCount:
useEffect(() => {
  if (needsFUCount > 0) {
    document.title = `(${needsFUCount}) Dashboard — Unified Sales Ops`;
  } else {
    document.title = "Dashboard — Unified Sales Ops";
  }
}, [needsFUCount]);
```

T6 doesn't own Dashboard.tsx, so this is a coordination request to T3 — T6 tells T3 to add it.

---

## FIX 6: Summary Page — "No leads" message is wrong
**Problem:** When `/api/ai/summary` returns `"No active leads to brief on today."` (the code in ai/summary/route.ts), the summary page renders it in the styled box. But the fallback Supabase query has never been tested and may show wrong data.

**Fix:** In the AI endpoint handler, when there are no leads:
```typescript
// Current: returns plain string
return NextResponse.json({
  content: "No active leads to brief on today.",
  generatedAt: now.toISOString(),
});

// Fine as-is — summary page renders it correctly
```

However, test the fallback: when the API fails (no GEMINI_API_KEY in dev), the page falls through to `FallbackBriefing`. Make the fallback header clearer:
```tsx
// In FallbackBriefing, replace the component header:
<div className="text-xs text-gray-600 bg-gray-900 border border-gray-800 rounded px-3 py-2 mb-4">
  Live data from your leads (AI briefing available when GEMINI_API_KEY is set)
</div>
```

---

## VERIFICATION
```
1. Load dashboard → Nav shows red badge with overdue count
2. Load inbox → Nav shows unread count badge on "Inbox"
3. Inbox: messages filtered by current mode (Sales/CSM)
4. Inbox: leads with null lead_id don't crash, show as plain text
5. Inbox: "Mark all read" button clears unread badges
6. Inbox: "Sent" tab shows outbound messages
7. Summary page: no amber "T3 coming soon" warning
8. Summary page: AI content renders as readable paragraphs, not <pre>
9. Summary page: clicking Refresh regenerates briefing
10. Lead detail: back button works from direct URL access
11. Mode switch in Nav → inbox refetches with correct mode filter
```

## COORDINATES WITH
- **T5**: Inbox relies on T5's RLS fix to actually return messages for the anon key. If messages are still returning empty after T6's mode filter, check T5's work on `alter table messages disable row level security`.
- **T3**: T3 adds the `document.title` update in Dashboard.tsx (T6 requests this but T3 implements since they own Dashboard.tsx)
- **T4**: Nav calls `/api/notifications?mode=sales` which T4 is NOT modifying — the endpoint is in `app/api/notifications/route.ts` and is not in T4's file list either. This route is available as-is. If it returns slow, T4 can add a lightweight count endpoint — coordinate.
