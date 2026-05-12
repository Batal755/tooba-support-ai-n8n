# Import Guide — outlook_slack_n8n_08.05.26 v5

**File:** `n8n/workflow.final-reply-to-slack-thread.v5.json`  
**Workflow name:** `outlook_slack_n8n_08.05.26 v5`  
**n8n version:** 2.15.0 (self-hosted)

---

## What changed in v5 vs v4

| v4 | v5 |
|---|---|
| `📧 Normalize Incoming Email` returns `[]` to stop | Always returns 1 item with `shouldPost: true/false` + `skipReason` |
| No way to see why email was filtered in Executions | `skipReason` visible in node output — easy to debug |
| No IF node | `✅ Incoming Should Post?` IF node added between Normalize and Slack |
| 8 nodes | 9 nodes |

Branch B (Sent Reply) is identical to v4 — no changes.

---

## ⚠️ Before you start — deactivate old workflows

Deactivate ALL previous versions before importing v5:
- `outlook_slack_n8n_08.05.26 v4`
- `Tooba Support Final Reply to Slack Thread v1`
- `Tooba Support AI Slack MVP 07.05`
- Any other Outlook-to-Slack workflows

Only one workflow should poll Inbox and SentItems at a time.

---

## Architecture

```
Branch A — incoming request:
🔔 Inbox Outlook Trigger
  → 📧 Normalize Incoming Email   (always returns 1 item: shouldPost + skipReason)
  → ✅ Incoming Should Post?       (IF: shouldPost === true)
      TRUE  → 💬 Post Request to Slack → 🧷 Store Slack Thread Mapping
      FALSE → dead end (check skipReason to understand why)

Branch B — manager sent reply:
📤 Sent Outlook Trigger
  → 📧 Normalize Sent Reply       (return [] if no matching conversationId)
  → 🔎 Find Slack Thread Mapping
  → 🧵 Post Final Reply to Slack Thread
```

---

## Step 1 — Download

```
https://raw.githubusercontent.com/batal755/tooba-support-ai-n8n/claude/n8n-email-automation-YRJs4/n8n/workflow.final-reply-to-slack-thread.v5.json
```

---

## Step 2 — Import

1. n8n → **Workflows** → **⊕ New Workflow** → **⋯** → **Import from File**
2. Select the downloaded file.
3. Workflow imports as `active = false`.

---

## Step 3 — Link credentials

| Node | Credential type |
|---|---|
| 🔔 Inbox Outlook Trigger | Microsoft Outlook OAuth2 API → `Microsoft Outlook account 06.05.26` |
| 📤 Sent Outlook Trigger | Microsoft Outlook OAuth2 API → same credential |
| 💬 Post Request to Slack | Slack API → `Slack Bot – Tooba Support` |
| 🧵 Post Final Reply to Slack Thread | Slack API → same Slack credential |

Required Graph permissions: `Mail.Read`, `Mail.ReadWrite`.  
Required Slack scope: `chat:write`. Bot must be invited to `#support_ai_test`.

---

## Step 4 — Verify Sent Items folder

`📤 Sent Outlook Trigger` uses folder `SentItems`. If the field is not recognised after import, try:
- `Sent Items`
- `Отправленные`

---

## Step 5 — Test incoming branch

1. Send an email to `support@tooba.com` with **exact subject** `Tooba Feedback`.
2. Wait up to 60 s.
3. Check n8n → Executions → `📧 Normalize Incoming Email` output:
   - `shouldPost: true` → continues to Slack ✅
   - `shouldPost: false` → check `skipReason` to diagnose the problem
4. Verify Slack card appears in `#support_ai_test`.

**If Slack card does NOT appear:**
- Open the execution and inspect `📧 Normalize Incoming Email` output.
- The `skipReason` field tells you exactly why the email was filtered.
- Common reasons: subject not exactly `Tooba Feedback`, sender is system relay without replyTo/cc, empty body.

---

## Step 6 — Test sent reply branch

1. In Outlook, open the original customer email in the `support@tooba.com` mailbox.
2. Click **Reply** (must be reply in same thread — same `conversationId`).
3. Write reply and **Send**.
4. Wait up to 60 s.
5. Verify sent reply text appears in the **thread** under the Slack card.

---

## ⚠️ Critical limitation

**Manager must click Reply on the original Outlook email — not create a new email.**

Matching is by `conversationId`. A new email will have a different `conversationId` and will not appear in the Slack thread.

---

## Step 7 — Activate

Toggle **Active** only after both branches are verified.
