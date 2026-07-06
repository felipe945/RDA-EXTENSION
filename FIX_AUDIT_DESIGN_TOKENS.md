# FIX_AUDIT — Shared Design Tokens (T3 ↔ T4)

> **T4 update (applied):** tokens confirmed and now live as CSS variables in `styles.css:root` —
> `--pink #FF3A69` / `--pink-rgb 255,58,105` (for alpha tints) and the navy-slate set
> `--slate-bg #0F1420 · --slate-card #151B2E · --slate-border #2A3554 · --slate-border2 #3A4668 ·
> --slate-text #94A3B8 · --slate-text2 #E2E8F0`. All sidepanel/popup pink routes through the token.
> **One deviation from the table below:** per FIX_AUDIT_T4 Task 1 ("update the logo hex so there's
> one pink"), the logo mark + wordmark are now **#FF3A69** too — `#F1567A` no longer exists anywhere.
> The logo's blue half stays `#8FBBFB` (logo-only). `stageColor("Replied")` and the update-banner
> are pink now (the two ⚠ leftovers flagged below are fixed).
> **Auth (D1):** background.js now exposes `FETCH_OPENER` (`{type, params:{channel, ig_username, name,
> bio, followers, lead_id}}`) and `RESEARCH_LEAD` (`{type, leadId}`) message handlers that call
> `/api/opener` / `/api/ai/research-lead` from the SW with the Bearer repToken. ⚠️ **T3/next wave:**
> `instagram.js:~1651` still fetches `/api/opener` directly from the content script — that request
> sends `Origin: https://www.instagram.com`, which T1's new CORS allowlist rejects. Swap it to
> `chrome.runtime.sendMessage({ type: "FETCH_OPENER", params })`.

Posted by **Terminal 3** after finishing `instagram.js`. T4: apply these exact hex
values to `sidepanel.js` / `styles.css` / `sidepanel.css` / `sidepanel.html` so both
surfaces read as one app.

## Brand (D-brand)
| Role | Hex | Notes |
|---|---|---|
| Primary pink | `#FF3A69` | The ONE canonical brand primary. One filled-pink button per view. |
| Pink tints | `#FF3A6912` (bg) / `#FF3A6940` (border) / `#FF3A6944` (focus border) / `#FF3A6922` (pill bg) | For banners/accents that must not compete with the primary |
| Logo pink | `#F1567A` | Logo mark + "FanMas" wordmark ONLY — never on buttons |
| Red | `#ef4444` text / `#7f1d1d` border | **DQ + error states only** |

## Neutral ground (V2 — navy-slate, from sidepanel.css)
| Role | Hex |
|---|---|
| Header / inset well (inputs, textareas, script boxes) | `#0A0E1A` |
| Card / surface bg | `#0F1420` |
| Raised surface (secondary buttons, selects, chips) | `#151B2E` |
| Border subtle | `#1A2235` |
| Border strong (inputs, interactive) | `#2A3554` |
| Border hover | `#3A4668` |
| Text primary | `#E2E8F0` |
| Text body | `#CBD5E1` |
| Text muted | `#94a3b8` |
| Text mid-faint | `#7C8AA8` |
| Text faint | `#5A6274` |
| Text disabled/labels | `#475569` |

Killed and mapped: `#111→#0F1420`, `#161616/#1a1a1a/#111118→#151B2E`,
`#0f0f12/#0a0a10→#0A0E1A`, `#252525/#232323/#1e1e2a/#1e1e28/#2a2a2a/#222/#1a1a22→#1A2235`,
`#2a2a35/#1e1e2e→#2A3554`, `#e5e5e5→#E2E8F0`, `#ddd/#ccc/#bbb→#CBD5E1`, `#888→#94a3b8`,
`#666→#7C8AA8`, `#555/#444/#6e7280→#5A6274`, `#333/#3a3a50/#3b3b50/#3a3a3a→#475569`.

## Purple is dead (C1/V1)
No `#7c3aed #8b5cf6 #c4b5fd #a78bfa #6d28d9 #4c3a8a #2d1a4a #1e1a2e #2a1f38` anywhere.
Folded into: **pink** for Replied/AI/inbound accents, **blue** for calendar (🌙 Late active =
`#0f2540` bg / `#1d4ed8` border / `#93c5fd` text).
⚠️ T4: `sidepanel.html` update-banner and `sidepanel.js` `stageColor("Replied")` still carry purple.

## Stage colors (stageColor — must match sidepanel.js)
`New #64748b · Warming #f59e0b · DM Sent #3b82f6 · Replied #FF3A69 (was purple) ·
Qualifying #06b6d4 · Call Offered #10b981 · Booked #22c55e · Closed #475569 · DQ #ef4444`
Legacy (Active/Churned) → fallback grey `#64748b`, display-only.

## Semantic (unchanged)
Success green `#0d2b0d` bg / `#166534` border / `#4ade80` text ·
Info blue `#0f2540` / `#1d4ed8` / `#93c5fd` (calendar) and `#3b82f6` accents ·
Warn amber `#2d1a00` / `#92400e` / `#fbbf24`.

## Channel model (F4)
IG card now tracks **2** channels only: `ig_fanbasis` ("FanBasis") + `ig_personal`
("Personal") — matching the sidepanel's 2 chips. LinkedIn/Email pills render only if a
lead has historic `outreach_channels` data, dimmed and suffixed "· manual".
