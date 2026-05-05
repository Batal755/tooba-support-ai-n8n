# Tooba Support AI — n8n Email Automation

Automated support email pipeline for **support@tooba.com**.

When a new email arrives in Outlook, this workflow:

1. Reads the email and extracts sender, subject, and body (HTML → plain text).
2. Posts the original customer email to Slack channel `#support_ai_test`.
3. Generates an AI reply draft using OpenAI and the Tooba FAQ knowledge base.
4. Creates an **unsent** reply draft in Outlook (via Microsoft Graph API).
5. Posts the AI draft into the Slack thread of the original message.

If the AI cannot find an answer in the knowledge base it returns exactly:

> **Нет подходящего ответа — требуется проверка менеджера.**

---

## Repository layout

```
.
├── workflows/
│   └── tooba-support-ai-n8n.workflow.json   ← n8n workflow (import this)
├── knowledge/
│   └── tooba_faq.md                          ← FAQ source of truth
├── prompts/
│   └── system_prompt.md                      ← System prompt source of truth
├── src/code/
│   ├── normalize-email.js                    ← Code node reference (email parsing)
│   ├── html-to-text.js                       ← HTML stripping utility
│   └── build-slack-message.js               ← Slack message format reference
├── scripts/
│   ├── validate-workflow.mjs                 ← Security + JSON validator
│   └── import-to-n8n.mjs                    ← Auto-import to n8n API
├── docs/
│   ├── setup.md                             ← Step-by-step setup guide
│   └── test-plan.md                         ← Test cases and acceptance criteria
├── .env.example                             ← Template for import script vars only
└── package.json
```

---

## Slack Channel ID is not a secret

`SLACK_CHANNEL_ID` is a plain channel ID (format: `C0ATU9ZD2UF`).  
It is **not a token, not a password, and not a secret.**

It is stored directly in the `⚙️ Config` Code node inside the workflow.  
After importing, open that node and change `slackChannelId` to your channel's ID.  
No environment variables and no n8n Variables are required for standard setup.

> **What IS secret:**  
> Slack Bot token (`xoxb-…`), OpenAI API key (`sk-…`), Microsoft OAuth token.  
> These must **never** be committed to Git or pasted into workflow node parameters.  
> Store them only in **n8n Credentials**.

---

## Required n8n credentials

Create all three credentials in n8n before importing the workflow.

### 1. Microsoft Outlook OAuth2 (support@tooba.com)

- n8n credential type: **Microsoft Outlook OAuth2 API**
- Required Graph API permissions: `Mail.Read`, `Mail.ReadWrite`
- Used in: `🔔 Outlook Trigger`, `📝 Create Outlook Draft`
- If using a shared mailbox: the OAuth account needs **Full Access** delegate rights.

### 2. OpenAI API Key

- n8n credential type: **OpenAI**
- Used in: `🌐 Call OpenAI API`

### 3. Slack Bot Token

- n8n credential type: **Slack API** (Bot token, starts with `xoxb-`)
- Required scope: `chat:write`
- The bot must be **invited to `#support_ai_test`** before the workflow runs.
- Used in: all Slack nodes (`💬 Post to Slack`, `🧵 Slack Thread: AI Draft`, both error nodes)

---

## Required Slack setup

1. Create a Slack App at api.slack.com/apps → **Create New App** → From scratch.
2. Add Bot Token scope: `chat:write`.
3. Install app to workspace → copy **Bot User OAuth Token** (starts with `xoxb-`).
4. In n8n → Credentials → Add Credential → **Slack API** → paste the token.
5. Invite the bot to the channel: type `/invite @YourBotName` inside `#support_ai_test`.
6. Find your channel ID: right-click `#support_ai_test` → **View channel details** → copy the ID at the bottom (format: `C0XXXXXXXXX`).

---

## Quick start

### 1. Import the workflow

**Option A — Automated** (requires n8n API enabled: Settings → n8n API → Enable):

```bash
cp .env.example .env.local
# Edit .env.local: set N8N_BASE_URL and N8N_API_KEY
npm run import:n8n
```

**Option B — Manual:**

n8n → Workflows → **⊕ New Workflow** → **⋯** → **Import from File** →  
select `workflows/tooba-support-ai-n8n.workflow.json`

### 2. Validate (optional, runs security scan)

```bash
npm run validate
```

### 3. Edit the Config node

Open `⚙️ Config` in the workflow editor and set:

```js
slackChannelId: 'C0ATU9ZD2UF',   // replace with your actual channel ID
```

### 4. Link credentials

See the setup checklist below.

### 5. Activate

Toggle **Active** in the workflow editor top-right corner.

---

## Setup checklist

After importing the workflow, complete every item before going live:

- [ ] **Import workflow** — n8n → Workflows → Import from File
- [ ] **Edit `⚙️ Config` node** — set `slackChannelId` to your actual channel ID
- [ ] **Select Microsoft Outlook credential** on `🔔 Outlook Trigger`
- [ ] **Select Microsoft Outlook credential** on `📝 Create Outlook Draft`
- [ ] **Select OpenAI credential** on `🌐 Call OpenAI API`
- [ ] **Select Slack credential** on `💬 Post to Slack`
- [ ] **Select Slack credential** on `🧵 Slack Thread: AI Draft`
- [ ] **Select Slack credential** on `❌ Slack: OpenAI Error`
- [ ] **Select Slack credential** on `❌ Slack: Outlook Error`
- [ ] **Invite bot to `#support_ai_test`** — `/invite @YourBotName`
- [ ] **Test Outlook Trigger** — run manually in n8n with a real email to verify the trigger fires
- [ ] **Test Slack main message** — confirm email appears in `#support_ai_test`
- [ ] **Test OpenAI** — confirm AI reply appears in thread (or fallback phrase if no FAQ match)
- [ ] **Test Outlook draft** — confirm unsent draft exists in Drafts folder
- [ ] **Test Slack thread** — confirm draft text and Draft ID appear in thread reply
- [ ] **Activate the workflow** — toggle Active in the workflow editor

---

## How to test

See `docs/test-plan.md` for full test cases. Quick check:

1. Send a test email to `support@tooba.com`.
2. Wait up to 60 seconds (one poll cycle).
3. Verify in `#support_ai_test`:
   - ✅ Main message with email content
   - ✅ Thread reply with AI draft
4. Verify in Outlook Drafts for `support@tooba.com`:
   - ✅ Draft reply exists and is **not sent**

---

## Updating the knowledge base

1. Edit `knowledge/tooba_faq.md` (version-controlled source of truth).
2. Copy the updated FAQ text into the `🤖 Build AI Prompt` Code node in n8n.
3. Save the workflow in n8n.
4. Export the updated workflow JSON and commit it.

---

## Troubleshooting

### `channel_not_found` in Slack node

- The `slackChannelId` in `⚙️ Config` is set to a channel **name** instead of a channel **ID**.
- Use the ID format: `C0XXXXXXXXX`, not `#support_ai_test`.

### `not_in_channel` in Slack node

- The bot has not been invited to `#support_ai_test`.
- Run `/invite @YourBotName` inside the channel.

### Microsoft Outlook OAuth failure

- The OAuth token may have expired. Re-authorise: n8n → Credentials → edit → reconnect.
- For shared mailboxes: ensure the OAuth account has Full Access delegate rights to `support@tooba.com`.

### OpenAI insufficient_quota

- Your OpenAI account has no remaining credits.
- Check platform.openai.com → Usage → billing.
- The workflow error branch posts a Slack thread message when OpenAI fails.

### `messageId missing` warning

- Outlook did not include an `id` field in the trigger payload.
- Check n8n execution logs → `📧 Normalize Email` → `_warnings` output.
- Without `messageId`, the Outlook createReply call will fail. The Slack main message is still posted.

### Unknown sender in Slack message

- Outlook did not include `from` or `sender` fields.
- `📧 Normalize Email` outputs `senderName: "Unknown Sender"` and adds a `_warnings` field.

### Workflow does not trigger

- Verify the workflow is **Active** (toggle in workflow editor top-right).
- Check the Outlook credential is valid and has `Mail.Read` permission.
- Check n8n → Executions for errors on the trigger node.

---

## Security

| Item | How it is handled |
|---|---|
| Slack Bot token (`xoxb-…`) | n8n Credential — never committed |
| OpenAI API key (`sk-…`) | n8n Credential — never committed |
| Microsoft OAuth token | n8n Credential — never committed |
| Slack Channel ID (`C0ATU9ZD2UF`) | **Not a secret** — stored in `⚙️ Config` node |

Run `npm run validate` before every commit to confirm no secrets are in the repository.

> **Optional:** If you run n8n Enterprise or Pro and prefer centralised variable management,
> you can move `slackChannelId` to an n8n Variable (Settings → Variables) and reference it
> in the Config node as `$vars.SLACK_CHANNEL_ID`. This is not required for standard setup.

---

## n8n version

Developed and tested against **n8n 2.15.0** (self-hosted).

> Some node parameter names (especially for HTTP Request body specification
> and Slack thread replies) may differ in other n8n versions.
> Nodes with uncertain parameters include a **TODO** note — check them
> in the n8n UI after import and adjust if needed.
