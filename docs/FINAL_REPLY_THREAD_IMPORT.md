# Import Guide — Tooba Support Final Reply to Slack Thread v1

**File to import:** `n8n/workflow.final-reply-to-slack-thread.v1.json`  
**Workflow name:** Tooba Support Final Reply to Slack Thread v1  
**n8n version:** 2.15.0 (self-hosted)

---

## What this workflow does

**Branch A — Incoming email:**  
When a customer sends a new email to `support@tooba.com` with the exact subject `Tooba Feedback`, the workflow posts a short request card to the Slack channel `#support_ai_test`.

**Branch B — Sent reply:**  
When a manager opens that email in Outlook, writes a reply, and **sends it**, the workflow detects the sent item in the Outlook Sent Items folder and posts the actual sent reply text into the Slack thread under the original card.

No AI, no draft creation, no automated email sending.

---

## Architecture

```
Branch A:
🔔 Inbox Outlook Trigger
  → 📧 Normalize Incoming Email   (filter + extract)
  → 💬 Post Request to Slack       (main channel card)
  → 🧷 Store Slack Thread Mapping  (save conversationId → thread_ts)

Branch B:
📤 Sent Outlook Trigger
  → 📧 Normalize Sent Reply        (match conversationId, dedup, strip quoted history)
  → 🔎 Find Slack Thread Mapping   (validate before posting)
  → 🧵 Post Final Reply to Slack Thread
```

Both branches share `$getWorkflowStaticData('global')` to store the `conversationId → Slack thread_ts` mapping. This is why both branches must live in the **same workflow**.

---

## Step 1 — Import the workflow

**Option A — Manual import:**

1. Download `n8n/workflow.final-reply-to-slack-thread.v1.json` from the repository.
2. In n8n: **Workflows** → **⊕ New Workflow** → **⋯** → **Import from File**
3. Select the downloaded JSON file.
4. The workflow is imported as inactive (`Active = OFF`).

**Option B — Via GitHub raw URL:**

```
https://raw.githubusercontent.com/batal755/tooba-support-ai-n8n/claude/n8n-email-automation-YRJs4/n8n/workflow.final-reply-to-slack-thread.v1.json
```

Download and import as above.

---

## Step 2 — Set the Slack channel ID

The default channel ID is `C0ATU9ZD2UF` (`#support_ai_test`).

To change it, update the channel ID in **three places**:

| Node | Where |
|---|---|
| 💬 Post Request to Slack | `channel` parameter — change `C0ATU9ZD2UF` |
| 🧷 Store Slack Thread Mapping | `const channelId = 'C0ATU9ZD2UF'` — edit in Code node |
| 🧵 Post Final Reply to Slack Thread | Uses `$json.slackChannelId` from mapping — changes automatically when you fix Store Slack Thread Mapping |

---

## Step 3 — Link credentials

Open each node and select the credential:

| Node | Credential type | Action |
|---|---|---|
| 🔔 Inbox Outlook Trigger | Microsoft Outlook OAuth2 API | Select `Microsoft Outlook account 06.05.26` or re-auth |
| 📤 Sent Outlook Trigger | Microsoft Outlook OAuth2 API | **Same credential** as above |
| 💬 Post Request to Slack | Slack API (Bot token) | Select `Slack Bot – Tooba Support` |
| 🧵 Post Final Reply to Slack Thread | Slack API (Bot token) | Same Slack credential |

Required Microsoft Graph permissions: `Mail.Read`, `Mail.ReadWrite` on `support@tooba.com`.  
Required Slack scope: `chat:write`. Bot must be invited to the channel.

---

## Step 4 — Verify Sent Items folder name

The `📤 Sent Outlook Trigger` uses folder `SentItems` (Microsoft Graph well-known name).

After import, open the node and check that the folder field shows "Sent Items" or "Отправленные". If the trigger does not find sent items, try these alternatives in the folder field:
- `SentItems`
- `Sent Items`
- `Отправленные`

---

## Step 5 — Test incoming branch

1. Send an email to `support@tooba.com` with **exact subject** `Tooba Feedback` (case-insensitive).
2. Wait up to 60 seconds.
3. Verify in n8n → Executions: `📧 Normalize Incoming Email` outputs `skip` is not present and `conversationId` is set.
4. Verify in `#support_ai_test`: a card appears with sender email, subject, and message text.

**What will NOT trigger Branch A:**
- Subject `Re: Tooba Feedback` — filtered out (only exact `tooba feedback` passes)
- Subject `Tooba feedback response` — filtered out
- Sender is `support@tooba.com` — filtered out
- Empty body — filtered out

---

## Step 6 — Test sent reply branch

1. In Outlook, open the original customer email in the `support@tooba.com` mailbox.
2. Click **Reply** (not Forward, not New Email — must be a reply in the same thread).
3. Write a short reply and **Send** it.
4. Wait up to 60 seconds.
5. Verify in n8n → Executions: `📧 Normalize Sent Reply` matches the `conversationId` and outputs `sentReplyText`.
6. Verify in Slack: the sent reply text appears in the **thread** under the original card — not as a new main channel message.

---

## ⚠️ Critical limitation

**The manager MUST use Outlook Reply on the original email, not create a new email.**

Matching is done by `conversationId` (Microsoft Graph conversation thread ID). If the manager creates a new email instead of replying, the `conversationId` will not match, and the sent reply will not appear in Slack.

---

## Step 7 — Activate

Only activate after all manual tests pass:

- [ ] Branch A: incoming card appears in Slack
- [ ] Branch B: sent reply appears in Slack thread
- [ ] Duplicate sent items do not create duplicate thread replies
- [ ] Non-Tooba-Feedback subjects do not appear in Slack

Toggle **Active** in the workflow editor top-right corner.
