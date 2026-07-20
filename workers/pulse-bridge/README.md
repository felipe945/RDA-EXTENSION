# pulse-bridge

Feeds FanMas **Pulse** (`/accounts`) from Felipe's Mac. Two read-only loops in one process:

- **WhatsApp** — Baileys (WhatsApp-Web protocol) on Felipe's personal number. 1:1 chats only, groups skipped. Handles offline catch-up (`append` upserts) — the server dedupes.
- **Slack** — polls the Commas workspace every 5 min **as Felipe** (his own `xoxp` user token — no bot, no app presence in channels). Per-channel cursors in `state.json` make downtime self-healing. Also reports Felipe's read cursor for "👀 seen · no reply" detection.

Both loops heartbeat every 60s so the dashboard can show a red "feed offline" banner instead of stale greens.

**⛔ This worker never sends a message anywhere. Read-only, permanently.**

## First run

```bash
cd workers/pulse-bridge
cp .env.example .env    # fill in FANMAS_URL, PULSE_BRIDGE_SECRET, SLACK_USER_TOKEN
npm install
npm start               # scan the QR with WhatsApp → Settings → Linked Devices
```

Getting the Slack token: api.slack.com/apps → Create New App → From manifest (JSON below) in the **Commas** workspace → Install to Workspace → copy the **User OAuth Token (xoxp-…)**. The "app" is just the OAuth client that mints your token — no bot user, no events, nothing visible to anyone.

```json
{ "display_information": { "name": "Pulse (Felipe personal, read-only)" },
  "oauth_config": { "scopes": { "user": [
    "channels:history","channels:read","groups:history","groups:read",
    "im:history","im:read","mpim:history","mpim:read","users:read"
  ] } },
  "settings": { "org_deploy_enabled": false, "socket_mode_enabled": false } }
```

## Keep it alive

pm2 (simplest):

```bash
npm i -g pm2
pm2 start index.mjs --name pulse-bridge
pm2 save && pm2 startup   # follow the printed instruction once
```

Or launchd: edit the paths in `com.felipe.pulse-bridge.plist`, then

```bash
cp com.felipe.pulse-bridge.plist ~/Library/LaunchAgents/
launchctl load ~/Library/LaunchAgents/com.felipe.pulse-bridge.plist
```

## Troubleshooting

- **WA "LOGGED OUT"** → delete `auth/`, `npm start`, re-scan the QR.
- **Dashboard shows "feed offline"** → `pm2 status` / `pm2 logs pulse-bridge`.
- **Slack loop silent** → token missing/revoked; `auth.test` failure is logged at boot.
- Baileys' API drifts between versions — if `npm install` pulls a newer major and events stop firing, check the release notes for `messages.upsert` / `connection.update` shape changes.
