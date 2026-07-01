# T3 Handoff — AI Research Pipeline + Chrome Extension

## Files Created

### AI Research Pipeline
- `lib/prompts/research.ts` — `buildResearchPrompt(profile)` function
- `app/api/ai/research-lead/route.ts` — POST /api/ai/research-lead

### Chrome Extension
- `ig-lead-tracker/manifest.json`
- `ig-lead-tracker/background.js`
- `ig-lead-tracker/instagram.js`
- `ig-lead-tracker/page-interceptor.js`
- `ig-lead-tracker/sidepanel.html`
- `ig-lead-tracker/sidepanel.js`
- `ig-lead-tracker/scripts-data.js`
- `ig-lead-tracker/styles.css`

---

## research_cache JSON Shape

Written to `leads.research_cache` (jsonb) after a successful /api/ai/research-lead call.
T2 should read this object to render the Research tab.

```json
{
  "estimatedGmv": 12000,
  "fitScore": 78,
  "fitReason": "Creator has a Shopify storefront linked in bio with 85k followers in the fitness niche — strong commerce signals.",
  "stackDetected": ["Shopify", "Linktree"],
  "summary": "Fitness creator with 85k followers running a Shopify merch store and digital training programs. Revenue signals suggest $10-15k/mo. FanBasis BNPL angle is strong given high-ticket coaching offers.",
  "suggestedOpener": "Hey! Saw your training program launch — are you seeing any checkout drop-off on the high-ticket plans?",
  "alreadyCustomer": false
}
```

### Field reference for T2

| Field | Type | Notes |
|-------|------|-------|
| `estimatedGmv` | number | Monthly USD estimate; 0 if no signals |
| `fitScore` | number 0–100 | Higher = better prospect |
| `fitReason` | string | 1-2 sentences explaining the score |
| `stackDetected` | string[] | Platform names (may be empty array) |
| `summary` | string | 2-3 sentence sales brief |
| `suggestedOpener` | string | Personalized DM opener, max 150 chars |
| `alreadyCustomer` | boolean | Always false (Metabase check is a TODO) |

---

## IG_PROFILE_SAVE Message Schema

This is the message that instagram.js sends to background.js, and that background.js forwards to the dashboard at POST /api/ig-events.

```js
// chrome.runtime.sendMessage payload (instagram.js → background.js)
{
  type: "IG_PROFILE_SAVE",
  username: string,       // IG username from URL slug
  userId: string,         // IG internal userId (may be empty "")
  pageUrl: string,        // full URL of profile page
  bio: string,            // from meta[name="description"] content
  followerCount: number,  // parsed from page text (best-effort)
  displayName: string     // from h2 element or falls back to username
}

// HTTP POST body to /api/ig-events (background.js → dashboard)
{
  type: "IG_PROFILE_SAVE",
  username: string,
  userId: string,
  pageUrl: string | null,
  bio: string,
  followerCount: number,
  displayName: string
}
```

The dashboard route (`app/api/ig-events/route.ts`, owned by T1) authenticates via the `x-ig-secret` header matched against `process.env.IG_EVENTS_SECRET`.

---

## ENV Vars

| Var | Owner | Notes |
|-----|-------|-------|
| `ANTHROPIC_API_KEY` | Auto-injected | Used by lib/claude.ts |
| `NEXT_PUBLIC_SUPABASE_URL` | T1 | Already in .env.local |
| `SUPABASE_SERVICE_ROLE_KEY` | T1 | Already in .env.local |
| `IG_EVENTS_SECRET` | T1 | Used to authenticate extension POSTs |

T3 adds no new env vars. `ANTHROPIC_API_KEY` is already present.

---

## Loading the Extension in Chrome

1. Open Chrome and navigate to `chrome://extensions`
2. Enable **Developer mode** (toggle in top-right corner)
3. Click **Load unpacked**
4. Select the `ig-lead-tracker/` directory inside this project
5. The extension icon appears in the toolbar
6. Click the icon to open the side panel
7. Go to Settings (⚙) and set your Dashboard URL + IG Secret

**Note:** The extension has no build step — all files are plain JS/HTML/CSS. No bundler needed.

---

## How research_status flows

```
none → pending (set at start of /api/ai/research-lead)
pending → complete (on success)
pending → error (on parse failure or DB error)
```

The route guards against re-processing: if `research_status === 'complete'` it returns 400.
T1's ig-events route fires POST /api/ai/research-lead fire-and-forget after creating a lead.
