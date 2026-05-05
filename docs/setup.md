# Setup Guide — Tooba Support AI n8n Automation

## Prerequisites

| Requirement | Version |
|---|---|
| n8n self-hosted | 2.15.0+ |
| Node.js | 18+ |
| Microsoft 365 account | with access to support@tooba.com |
| OpenAI account | with API key |
| Slack workspace | with bot token |

---

## Step 1 — Clone the repository

```bash
git clone https://github.com/batal755/tooba-support-ai-n8n.git
cd tooba-support-ai-n8n
```

---

## Step 2 — Create .env.local

```bash
cp .env.example .env.local
```

Edit `.env.local`:

```env
N8N_BASE_URL=http://localhost:5678   # URL of your n8n instance
N8N_API_KEY=your_api_key_here        # n8n → Settings → n8n API → Create
SLACK_CHANNEL_ID=C0XXXXXXXXX         # Channel ID of #support_ai_test
```

> **.env.local is gitignored and must never be committed.**

---

## Step 3 — Create n8n Credentials

Open your n8n instance and create these credentials before importing the workflow.

### 3.1 Microsoft Outlook OAuth2

1. n8n → Credentials → Add Credential → **Microsoft Outlook OAuth2 API**
2. Follow the OAuth2 flow to authorise `support@tooba.com`.
3. Required Microsoft Graph API permissions:
   - `Mail.Read`
   - `Mail.ReadWrite` (to create reply drafts)
   - `Mail.Send` is **not** required — drafts are never auto-sent.
4. If using a shared mailbox, the account used for OAuth must have **Full Access** delegate rights to `support@tooba.com`.
5. Name the credential exactly: **Microsoft Outlook – support@tooba.com**

### 3.2 OpenAI API Key

1. n8n → Credentials → Add Credential → **OpenAI**
2. Paste your API key from platform.openai.com → API keys.
3. Name the credential: **OpenAI account**

### 3.3 Slack Bot Token

1. Create a Slack App at api.slack.com/apps → **Create New App** → From scratch.
2. Add OAuth Scopes under **Bot Token Scopes**:
   - `chat:write`
3. Install the app to your workspace.
4. Copy the **Bot User OAuth Token** (starts with `xoxb-`).
5. n8n → Credentials → Add Credential → **Slack API**
6. Paste the Bot token.
7. Name the credential: **Slack Bot – Tooba Support**
8. Invite the bot to `#support_ai_test`: `/invite @YourBotName`

---

## Step 4 — Configure SLACK_CHANNEL_ID in n8n

**Option A — n8n Variables (recommended)**

n8n → Settings → Variables → Add Variable:
- Key: `SLACK_CHANNEL_ID`
- Value: `C0XXXXXXXXX` (your channel ID)

Access in expressions: `{{ $vars.SLACK_CHANNEL_ID }}`

**Option B — Environment variable**

Add `SLACK_CHANNEL_ID=C0XXXXXXXXX` to the environment where n8n runs (`.env` file, Docker compose, systemd unit, etc.).

Access in expressions: `{{ $env.SLACK_CHANNEL_ID }}`

> The workflow uses `{{ $env.SLACK_CHANNEL_ID || $vars.SLACK_CHANNEL_ID }}` — either option works.

**How to find a Slack channel ID:**
Right-click the channel in Slack → **View channel details** → scroll to bottom → copy the ID (format: `C0XXXXXXXXX`).

---

## Step 5 — Validate

```bash
npm run validate
```

Expected output:
```
✅ Valid JSON — workflow name: "Tooba Support AI – Email Processing"
✅ No secret patterns found
✅ All structural checks passed
```

---

## Step 6 — Import the workflow

**Option A — Automated (requires n8n API enabled)**

Enable the n8n API first: n8n → Settings → n8n API → toggle ON → copy the key.

```bash
npm run import:n8n
```

The script prints the created workflow ID and URL.

**Option B — Manual**

1. Open n8n → Workflows → **⊕ New Workflow**
2. Click **⋯** (top right) → **Import from File**
3. Select `workflows/tooba-support-ai-n8n.workflow.json`
4. Click **Save**

---

## Step 7 — Link credentials in the workflow

After import, n8n will show "Credential is not set" warnings on several nodes.

Open each node and link the correct credential:

| Node | Credential type |
|---|---|
| 🔔 Outlook Trigger | Microsoft Outlook OAuth2 |
| 📝 Create Outlook Draft | Microsoft Outlook OAuth2 |
| 🌐 Call OpenAI API | OpenAI |
| 💬 Post to Slack | Slack API |
| 🧵 Slack Thread: AI Draft | Slack API |
| ❌ Slack: OpenAI Error | Slack API |
| ❌ Slack: Outlook Error | Slack API |

---

## Step 8 — Verify Outlook URL for shared mailbox

Open node **📝 Create Outlook Draft** → URL field.

Default (shared mailbox):
```
https://graph.microsoft.com/v1.0/users/support@tooba.com/messages/{messageId}/createReply
```

If the signed-in OAuth user IS `support@tooba.com` (personal mailbox or direct login), use:
```
https://graph.microsoft.com/v1.0/me/messages/{messageId}/createReply
```

---

## Step 9 — Activate the workflow

In the n8n workflow editor: toggle **Active** in the top-right corner.

The Outlook Trigger will start polling every minute.

---

## Step 10 — Test

See `docs/test-plan.md` for full test instructions.

Quick smoke test:
1. Send an email to `support@tooba.com` with any subject.
2. Wait up to 60 seconds.
3. Check `#support_ai_test` in Slack — you should see:
   - A main message with the email content.
   - A thread reply with the AI draft.
4. Check Outlook Drafts folder for `support@tooba.com` — the draft should be there, unsent.
