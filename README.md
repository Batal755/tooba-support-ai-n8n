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
├── .env.example                             ← Environment variable template
└── package.json
```

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
- Used in: all Slack nodes

---

## Required Slack setup

1. Create a Slack App at api.slack.com/apps.
2. Add Bot Token scope: `chat:write`.
3. Install app to workspace → copy Bot User OAuth Token.
4. Invite the bot: `/invite @YourBotName` inside `#support_ai_test`.
5. Find the channel ID: right-click `#support_ai_test` → View channel details → copy ID (format: `C0XXXXXXXXX`).
6. Set `SLACK_CHANNEL_ID` as an n8n Variable or environment variable (see below).

---

## Quick start

### 1. Create .env.local

```bash
cp .env.example .env.local
# Edit .env.local with real values — never commit this file
```

### 2. Validate

```bash
npm run validate
```

Checks: workflow JSON is valid, no secrets are present in the repository.

### 3. Import to n8n

```bash
npm run import:n8n
```

Or manually: n8n → Workflows → Import from File → select `workflows/tooba-support-ai-n8n.workflow.json`.

### 4. Link credentials

After import, open the workflow and link credentials to each node that shows a warning. See `docs/setup.md` Step 7.

### 5. Set SLACK_CHANNEL_ID

n8n → Settings → Variables → Add:
- Key: `SLACK_CHANNEL_ID`
- Value: `C0XXXXXXXXX`

### 6. Activate

Toggle **Active** in the workflow editor top-right.

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

- `SLACK_CHANNEL_ID` is set to a channel name instead of a channel ID.
- Use the ID format: `C0XXXXXXXXX`, not `#support_ai_test`.

### `not_in_channel` in Slack node

- The bot has not been invited to `#support_ai_test`.
- Run `/invite @YourBotName` in the channel.

### Microsoft Outlook OAuth failure

- The OAuth token may have expired. Re-authorise the credential in n8n → Credentials → edit → reconnect.
- For shared mailboxes: ensure the OAuth user has Full Access delegate rights.

### OpenAI insufficient_quota

- Your OpenAI account has no remaining credits.
- Check platform.openai.com → Usage → billing.
- The workflow error branch posts a Slack thread message when OpenAI fails.

### `messageId missing` warning

- Outlook did not include an `id` field in the trigger payload.
- This is rare. Check n8n execution logs → `📧 Normalize Email` node → `_warnings` output.
- Without `messageId`, the Outlook createReply call will fail. The Slack main message is still posted.

### Unknown sender in Slack message

- Outlook did not include `from` or `sender` fields.
- The `📧 Normalize Email` node outputs `senderName: "Unknown Sender"`.
- Check `_warnings` in the execution log for details.

### Workflow does not trigger

- Verify the workflow is **Active** (toggle in top-right of workflow editor).
- Check the Outlook credential is valid and has Mail.Read permission.
- Check n8n executions: n8n → Executions — look for errors on the trigger.

---

## Security

- No API keys, tokens, or passwords are stored in this repository.
- Use n8n Credentials for all secrets.
- `.env.local` is gitignored.
- Run `npm run validate` before every commit to confirm no secrets are present.

---

## n8n version

Developed and tested against **n8n 2.15.0** (self-hosted).

> Some node parameter names (especially for HTTP Request body specification
> and Slack thread replies) may differ in other n8n versions.
> Nodes with uncertain parameters include a **TODO** note — check them
> in the n8n UI after import and adjust if needed.
