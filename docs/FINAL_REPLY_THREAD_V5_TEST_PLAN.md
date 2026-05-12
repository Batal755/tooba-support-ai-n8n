# Test Plan — outlook_slack_n8n_08.05.26 v5

**File:** `n8n/workflow.final-reply-to-slack-thread.v5.json`  
**Channel:** `#support_ai_test` (`C0ATU9ZD2UF`)

---

## Pre-test checklist

- [ ] v5 imported and **inactive** during manual tests
- [ ] All previous workflows deactivated
- [ ] Outlook credential linked to both trigger nodes
- [ ] Slack credential linked to both Slack nodes
- [ ] Bot invited to `#support_ai_test`
- [ ] n8n → Executions open for observation

---

## TC-01 — New Tooba Feedback creates main Slack card

**Steps:**
1. Send email to `support@tooba.com`, subject exactly `Tooba Feedback`, body ≥ 10 chars, with real customer address in `replyTo` or `ccRecipients`.
2. Wait up to 60 s.

**Expected:**

| Node | Output |
|---|---|
| 📧 Normalize Incoming Email | `shouldPost: true`; `senderEmail` set; `conversationId` set |
| ✅ Incoming Should Post? | Routes to TRUE output → 💬 Post Request to Slack |
| 💬 Post Request to Slack | Card in `#support_ai_test`; response has `ts` |
| 🧷 Store Slack Thread Mapping | `{ ok: true, conversationId, threadTs }` |

**Expected Slack card:**
```
ID обращения: 12596
Email: yaroslav.chibizov@gmail.com
Тема: Tooba Feedback
Сообщение: Здравствуйте, подскажите как создать пост
```

---

## TC-02 — Re: Tooba Feedback does NOT create main Slack card

**Steps:**
1. Send email to `support@tooba.com` with subject `Re: Tooba Feedback`.
2. Wait 60 s.

**Expected:**
- `📧 Normalize Incoming Email` returns `shouldPost: false`, `skipReason: "reply/forward subject ignored for incoming branch"`.
- `✅ Incoming Should Post?` routes to FALSE output — dead end.
- **No new Slack message.**

Also test:
- `Ответить: Tooba Feedback` → `shouldPost: false`
- `Fwd: Tooba Feedback` → `shouldPost: false`
- `FW: Tooba Feedback` → `shouldPost: false`

---

## TC-03 — Unknown sender does NOT create main Slack card

**Steps:**
1. Send email where `from`, `sender`, `replyTo`, `ccRecipients` all resolve to `support@tooba.com` or system addresses.

**Expected:**
- `shouldPost: false`, `skipReason` = `"own support email ignored"` or `"senderEmail not found"`.
- No Slack card.

---

## TC-04 — Normalize output shows shouldPost=false + skipReason for filtered emails

**Goal:** Confirm that filtered emails are visible and debuggable in n8n Executions.

**Steps:**
1. Trigger any filtered scenario (TC-02 or TC-03).
2. Open n8n → Executions → click the execution → open `📧 Normalize Incoming Email`.

**Expected:**
- Output JSON contains `shouldPost: false`.
- Output JSON contains `skipReason` with a human-readable reason.
- `✅ Incoming Should Post?` node is visible in the execution graph.

---

## TC-05 — Manager replies in Outlook

**Pre-condition:** TC-01 completed; `conversationId` stored in static data.

**Steps:**
1. In Outlook, open original email in `support@tooba.com` mailbox.
2. Click **Reply** (same thread — same `conversationId`).
3. Write text ≥ 10 chars.
4. Click **Send**.
5. Wait up to 60 s.

**Expected:**

| Node | Output |
|---|---|
| 📧 Normalize Sent Reply | Returns item; `sentReplyText` set; `slackThreadTs` set |
| 🔎 Find Slack Thread Mapping | Passes through |
| 🧵 Post Final Reply to Slack Thread | Posted in thread |

---

## TC-06 — Sent reply appears in Slack thread

**Expected Slack thread reply:**
```
✅ Ответ менеджера отправлен в Outlook

Кому: yaroslav.chibizov@gmail.com

Текст ответа:
Здравствуйте!
[реальный ответ менеджера]
```

**Verify:**
- Appears as a thread reply under the TC-01 main card.
- Quoted email history (after `От:`, `From:`, `--- Original Message ---`) is stripped.
- Outlook mobile footer stripped.

---

## TC-07 — Sent reply does NOT appear in main channel

**Expected:**
- Main `#support_ai_test` timeline: only the TC-01 card.
- Manager reply visible only inside the thread.

---

## TC-08 — Duplicate sent item does not duplicate thread reply

**Steps:**
1. Re-run Branch B with the same sent payload (n8n "Test step").

**Expected:**
- `📧 Normalize Sent Reply` returns `[]` (messageId already in `processedSentMessageIds`).
- No duplicate thread reply.

---

## Acceptance criteria

| # | Test case | Status |
|---|---|---|
| TC-01 | Incoming Tooba Feedback → Slack card | ⬜ |
| TC-02 | Re: Tooba Feedback → no Slack card | ⬜ |
| TC-03 | Unknown sender → no Slack card | ⬜ |
| TC-04 | skipReason visible in Executions | ⬜ |
| TC-05 | Manager sends reply → Branch B detects it | ⬜ |
| TC-06 | Sent reply in Slack thread | ⬜ |
| TC-07 | Sent reply NOT in main channel | ⬜ |
| TC-08 | Duplicate dedup works | ⬜ |

---

## Debugging guide

**If main Slack card does not appear:**
1. Open n8n → Executions → find the execution.
2. Click `📧 Normalize Incoming Email` → inspect output.
3. Read `shouldPost` and `skipReason`.
4. Do NOT debug Slack or downstream nodes until `shouldPost: true` is confirmed.

Common `skipReason` values:

| skipReason | Fix |
|---|---|
| `subject does not contain Tooba Feedback` | Email subject does not match — check Outlook Trigger filter |
| `reply/forward subject ignored for incoming branch` | Correct — this is a reply, not original request |
| `senderEmail not found` | Check `from`, `replyTo`, `ccRecipients` fields in raw trigger output |
| `own support email ignored` | Email from `support@tooba.com` itself — correct filter |
| `cleanBody too short` | Email body is empty or too short |
