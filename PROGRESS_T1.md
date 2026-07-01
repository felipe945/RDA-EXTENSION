# T1 Progress — Backend / Infrastructure

## Status: COMPLETE ✓

---

## What T1 Found Already Built (other terminal)

| File | State |
|------|-------|
| `lib/apify.ts` | ✓ Done — `fetchIgProfile(username)` |
| `lib/scoring.ts` | ✓ Done — `scoreLead({bio, followerCount, externalUrl, researchCache})` |
| `lib/prompts/research.ts` | ✓ Done — `buildResearchPrompt()` |
| `app/api/ai/research-lead/route.ts` | ✓ Done — T3's Claude research pipeline |
| `app/api/leads/route.ts` | ✓ Done — GET/POST/PATCH/DELETE |
| `app/api/sendblue/route.ts` | ✓ Done (fixed direction/channel values) |
| `app/api/gmail/route.ts` | ✓ Done (fixed direction/channel values) |
| `app/api/ig-events/route.ts` | ✓ Done + extended (see below) |

---

## What T1 Did This Session

### Created
- `lib/types.ts` — canonical TypeScript types for Lead, Message, ResearchStatus, MessageChannel (aligned to DB conventions)
- `vercel.json` — Vercel cron: Gmail sync every 30 min

### Updated
- `lib/supabase-schema.sql` — Added ALTER TABLE statements (7 new columns) + full messages table DDL
- `app/api/ig-events/route.ts` — Added: scoring call, save event recorded in ig_events array, VERCEL_URL fallback for fire-and-forget URL
- `app/api/sendblue/route.ts` — Fixed: `direction: "in"` → `"inbound"`, `channel: "SMS"` → `"sms"`
- `app/api/gmail/route.ts` — Fixed: `direction: "in"` → `"inbound"`, `channel: "Email"` → `"email"`
- `lib/types.ts` — Aligned field names to actual DB: `ig_profile_url`, `research_status: "error"` (not "failed"), `MessageChannel` lowercase

---

## Cross-Terminal Mismatches Fixed

| Issue | Fix |
|-------|-----|
| inbox/page.tsx queries `direction = "inbound"` but sendblue/gmail inserted `"in"` | Fixed both routes to use `"inbound"` |
| inbox/page.tsx expects `channel = "sms"/"email"` (lowercase) but routes inserted `"SMS"/"Email"` | Fixed both routes |
| ig-events IG_PROFILE_SAVE: save event not recorded in ig_events array | Fixed — now appends event |
| ig-events IG_PROFILE_SAVE: no scoring on initial save | Fixed — calls `scoreLead()` |

---

## Supabase Migration Required

Run these in the Supabase SQL editor **before** testing the full app:

```sql
-- Paste the full lib/supabase-schema.sql into the editor
-- The ALTER TABLE and CREATE TABLE IF NOT EXISTS sections are safe to re-run
```

The ALTER TABLE block adds: `ig_profile_url`, `ig_user_id`, `bio`, `follower_count`, `score`, `research_status`, `research_cache`

The CREATE TABLE block adds: `messages` table with realtime enabled

---

## ENV Vars Still Needed

| Var | Used By | Notes |
|-----|---------|-------|
| `IG_EVENTS_SECRET` | ig-events route + Chrome ext | Generate any random string |
| `APIFY_TOKEN` | lib/apify.ts | Get from apify.com |
| `SENDBLUE_WEBHOOK_SECRET` | sendblue/route.ts | From SendBlue dashboard |
| `NEXT_PUBLIC_BASE_URL` | ig-events fire-and-forget | Optional; `VERCEL_URL` is checked first |

---

## T3 Coordination Notes

The ig-events route accepts this payload for IG_PROFILE_SAVE:
```json
{
  "type": "IG_PROFILE_SAVE",
  "username": "profileHandle",
  "userId": "123456789",
  "profileUrl": "https://www.instagram.com/profileHandle/",
  "displayName": "Display Name",
  "bio": "Bio text here",
  "followerCount": 12500
}
```
Note: `followerCount` is camelCase (matches what the existing ig-events route destructures).
The route stores it as `follower_count` (snake_case) in the DB.

T3's `inject-save-btn.js` must also send `x-ig-secret: <IG_EVENTS_SECRET>` header.
