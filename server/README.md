# Tooba Support Bridge (standalone server)

Replaces the n8n workflow. Pure Node.js, **zero npm dependencies**
(native `fetch` + JSON file state). Requires Node 18+.

## What it does

Every `POLL_SECONDS` it:

1. Reads new **Inbox** messages via Microsoft Graph.
   - New conversation → posts a card to Slack, stores `conversationId → thread_ts`.
   - Known conversation → posts the message as a reply in the existing Slack thread.
2. Reads new **Sent Items** (manager replies).
   - If the conversation is mapped → mirrors the reply into the same Slack thread.

State (thread map + dedup) lives in `server/state.json`.

## Setup (one time)

### 1. Azure App Registration (Microsoft Graph)

- Azure Portal → **App registrations** → **New registration**.
- **API permissions** → Microsoft Graph → **Application permissions**:
  `Mail.Read`, `Mail.Send` → then **Grant admin consent**.
- **Certificates & secrets** → **New client secret** → copy the value.
- Copy **Tenant ID** and **Client ID** from the app Overview page.

### 2. Slack App

- api.slack.com/apps → your app → **OAuth & Permissions**.
- Bot Token Scopes: `chat:write`.
- Install to workspace → copy **Bot User OAuth Token** (`xoxb-...`).
- Invite the bot to the channel: `/invite @yourbot` in `#support_ai_test`.

### 3. Config

```bash
cp server/.env.example server/.env
# edit server/.env with the values above
```

## Run

```bash
npm run server
```

Leave it running (use `pm2`, `systemd`, or `screen` for production):

```bash
# example with pm2
npx pm2 start server/index.js --name tooba-bridge
npx pm2 save
```

## Notes

- First run processes recent inbox messages, then only new ones.
- `state.json` is the source of truth — back it up; deleting it resets all
  thread mappings (new emails would start fresh threads).
- All sender resolution logic (relay handling, body-embedded customer email,
  HTML→text, quote stripping) is in `normalize.js`.
