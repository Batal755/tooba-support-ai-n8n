# Import Guide — outlook_slack_n8n_08.05.26 v4

**File to import:** `n8n/workflow.final-reply-to-slack-thread.v4.json`  
**Workflow name:** `outlook_slack_n8n_08.05.26 v4`  
**n8n version:** 2.15.0 (self-hosted)

---

## ⚠️ Before you start

**Deactivate all previous versions of this workflow** before importing v4:
- `Tooba Support Final Reply to Slack Thread v1` — deactivate
- `Tooba Support AI Slack MVP 07.05` — deactivate
- `Tooba Support AI FIXED 06.05` — deactivate
- Any other Tooba support workflows — deactivate

Only one workflow should poll Inbox and SentItems at a time. Running multiple versions simultaneously will cause duplicate Slack messages.

---

## What changed in v4 (hotfix)

**Root cause of the bug:** Previous versions accepted `Re: Tooba Feedback` as an incoming request, posting an empty card to Slack (empty sender, empty body).

**Fix:** `📧 Normalize Incoming Email` now hard-stops on any subject that is not **exactly** `tooba feedback` (case-insensitive). A `return []` exits the entire branch — Slack is never called for replies, forwards, or unrelated subjects.

Additional cleanup added to `cleanBody`:
- Strips `OpenAI не сгенерировал…` artifacts from older workflow runs

---

## Architecture

```
Branch A — incoming customer request:
🔔 Inbox Outlook Trigger
  → 📧 Normalize Incoming Email   (hard-stop: exact 'tooba feedback' only)
  → 💬 Post Request to Slack      (main channel card)
  → 🧷 Store Slack Thread Mapping (conversationId → thread_ts)

Branch B — manager sent reply:
📤 Sent Outlook Trigger
  → 📧 Normalize Sent Reply       (match conversationId, dedup, strip quoted history)
  → 🔎 Find Slack Thread Mapping  (validate before posting)
  → 🧵 Post Final Reply to Slack Thread
```

No IF nodes. No shouldPost flags. No OpenAI. No Outlook Draft.

---

## Step 1 — Import

**Raw download URL:**
```
https://raw.githubusercontent.com/batal755/tooba-support-ai-n8n/claude/n8n-email-automation-YRJs4/n8n/workflow.final-reply-to-slack-thread.v4.json
```

1. Download the file.
2. n8n → **Workflows** → **⊕ New Workflow** → **⋯** → **Import from File**
3. Select the downloaded file.
4. Workflow imports as `active = false`.

---

## Step 2 — Link credentials

| Node | Credential type | Name |
|---|---|---|
| 🔔 Inbox Outlook Trigger | Microsoft Outlook OAuth2 API | `Microsoft Outlook account 06.05.26` |
| 📤 Sent Outlook Trigger | Microsoft Outlook OAuth2 API | Same credential |
| 💬 Post Request to Slack | Slack API (Bot token) | `Slack Bot – Tooba Support` |
| 🧵 Post Final Reply to Slack Thread | Slack API (Bot token) | Same Slack credential |

Required Microsoft Graph permissions: `Mail.Read`, `Mail.ReadWrite`.  
Required Slack scope: `chat:write`. Bot must be in the channel.

---

## Step 3 — Verify Sent Items folder

The `📤 Sent Outlook Trigger` uses folder `SentItems`. After import, open the node and confirm the folder field is recognized. If not, try:
- `Sent Items`
- `Отправленные`

---

## Step 4 — Test incoming branch

1. Send an email to `support@tooba.com` with **exact subject** `Tooba Feedback`.
2. Wait up to 60 seconds.
3. Verify in `#support_ai_test`: card appears with correct sender, subject, body.
4. Send another email with subject `Re: Tooba Feedback` — verify **no** new Slack card appears.

---

## Step 5 — Test sent reply branch

1. In Outlook, open the original customer email in `support@tooba.com` mailbox.
2. Click **Reply** — must be reply in same thread (same `conversationId`).
3. Write reply text and **Send**.
4. Wait up to 60 seconds.
5. Verify: sent reply text appears in the **thread** under the original Slack card.
6. Verify: NO new main channel message is posted.

---

## ⚠️ Critical limitation

**Manager must use Outlook Reply on the original email — not create a new email.**

Matching works by `conversationId`. A new email has a different `conversationId` and will not appear in Slack.

---

## Step 6 — Activate

Toggle **Active** only after both branches are tested successfully.
