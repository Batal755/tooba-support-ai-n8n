# Test Plan — Tooba Support Final Reply to Slack Thread v1

**Workflow file:** `n8n/workflow.final-reply-to-slack-thread.v1.json`  
**Channel under test:** `#support_ai_test` (`C0ATU9ZD2UF`)

---

## Pre-test checklist

- [ ] Workflow imported from `n8n/workflow.final-reply-to-slack-thread.v1.json`
- [ ] Workflow is **inactive** during manual tests
- [ ] Both Outlook triggers linked to `Microsoft Outlook account 06.05.26`
- [ ] Both Slack nodes linked to `Slack Bot – Tooba Support`
- [ ] Bot invited to `#support_ai_test`
- [ ] n8n → Executions open in a separate tab for observation

---

## TC-01 — Incoming Tooba Feedback posts main Slack message

**Goal:** A customer email with exact subject `Tooba Feedback` creates a card in the Slack channel.

**Steps:**
1. Send an email to `support@tooba.com`:
   - Subject: `Tooba Feedback`
   - Body: any text ≥ 10 characters
2. Wait up to 60 seconds.
3. Open n8n → Executions.

**Expected results:**

| Node | Expected output |
|---|---|
| 🔔 Inbox Outlook Trigger | Fires; item has `isDraft: false`, `conversationId` set |
| 📧 Normalize Incoming Email | Returns item with `senderEmail`, `cleanBody`, `conversationId`; NOT `[]` |
| 💬 Post Request to Slack | Message visible in `#support_ai_test`; response has `ts` |
| 🧷 Store Slack Thread Mapping | Returns `{ ok: true, conversationId, threadTs }` |

**Expected Slack message format:**
```
ID обращения: —
Email: customer@example.com
Тема: Tooba Feedback
Сообщение: <customer message text>
```

---

## TC-02 — Re: Tooba Feedback does NOT create main Slack message

**Goal:** Reply emails are not posted to the main channel.

**Steps:**
1. Reply to the email sent in TC-01 (from customer to `support@tooba.com`) — or send an email with subject `Re: Tooba Feedback`.
2. Wait 60 seconds.

**Expected results:**
- `📧 Normalize Incoming Email` returns `[]` (subject is `re: tooba feedback`, not exactly `tooba feedback`).
- No new Slack message in `#support_ai_test`.
- Branch A stops at `📧 Normalize Incoming Email`.

---

## TC-03 — No UNKNOWN sender if replyTo / ccRecipients / body has email

**Goal:** Sender is correctly extracted from replyTo, cc, or embedded address — not `UNKNOWN`.

**Steps:**
1. Send a Tooba Feedback email where:
   - `from` is `no-reply@mx.tooba.com` (forwarding relay),
   - `replyTo` is `customer@gmail.com`, OR
   - `ccRecipients` contains `customer@gmail.com`.

**Expected results:**
- `📧 Normalize Incoming Email` outputs `senderEmail: "customer@gmail.com"` (not `unknown` or `no-reply@mx.tooba.com`).
- Slack card shows `Email: customer@gmail.com`.

---

## TC-04 — Manager sends reply in Outlook

**Goal:** Branch B detects the sent reply.

**Pre-condition:** TC-01 has been run; `conversationId` is stored in static data.

**Steps:**
1. Open the original customer email in Outlook for `support@tooba.com`.
2. Click **Reply** (must be reply in the same thread — same `conversationId`).
3. Write reply text ≥ 10 characters.
4. Click **Send**.
5. Wait up to 60 seconds.
6. Check n8n → Executions for Branch B.

**Expected results:**

| Node | Expected output |
|---|---|
| 📤 Sent Outlook Trigger | Fires; item has `isDraft: false`, same `conversationId` as TC-01 |
| 📧 Normalize Sent Reply | Returns item with `sentReplyText`, `slackChannelId`, `slackThreadTs` |
| 🔎 Find Slack Thread Mapping | Passes through — all fields present |
| 🧵 Post Final Reply to Slack Thread | Posts in thread; no new main channel message |

---

## TC-05 — Sent reply appears in Slack thread

**Goal:** Manager's sent reply text appears in the correct Slack thread.

**Pre-condition:** TC-01 and TC-04 completed.

**Expected Slack thread reply format:**
```
✅ Ответ менеджера отправлен в Outlook
Кому: customer@example.com
Текст ответа:
<manager reply text, without quoted email history>
```

**Verify:**
- Reply appears under the TC-01 card as a thread reply.
- Quoted email history (everything after `От:`, `From:`, `--- Original Message ---`) is stripped.
- The Outlook mobile "Get Outlook for Android/iOS" footer is stripped.

---

## TC-06 — Sent reply does NOT appear as new main channel message

**Goal:** Manager's reply is posted only in thread, not as a new main channel message.

**Pre-condition:** TC-04 completed.

**Expected:**
- In `#support_ai_test`: only the original TC-01 card is visible in the main feed.
- Manager reply is visible **only** inside the thread of that card.

**How to verify:**
- In Slack, check the main channel timeline — only 1 message (TC-01 card) should appear.
- Open the thread of that card — the manager reply is visible there.

---

## TC-07 — Duplicate sent item does not duplicate thread reply

**Goal:** If Branch B triggers twice for the same sent message (e.g., trigger polling overlaps), only one thread reply is posted.

**Steps:**
1. Note the `messageId` of the sent reply from TC-04 (visible in n8n execution output).
2. Manually re-run Branch B with the same sent item payload (use n8n "Test step").

**Expected results:**
- `📧 Normalize Sent Reply` returns `[]` on the second run (messageId already in `processedSentMessageIds`).
- No duplicate Slack thread reply.

---

## Acceptance criteria

| # | Test case | Status |
|---|---|---|
| TC-01 | Incoming Tooba Feedback posts main Slack message | ⬜ |
| TC-02 | Re: Tooba Feedback does not post to main channel | ⬜ |
| TC-03 | No UNKNOWN sender when replyTo/cc/body has real email | ⬜ |
| TC-04 | Manager sends reply → Branch B detects it | ⬜ |
| TC-05 | Sent reply appears in Slack thread | ⬜ |
| TC-06 | Sent reply does NOT appear in main channel | ⬜ |
| TC-07 | Duplicate sent item does not duplicate thread reply | ⬜ |

All 7 test cases must pass before activating in production.

---

## Known limitations

1. **Manager must reply in the same Outlook thread.** Matching is by `conversationId`. If a manager creates a new email instead of clicking Reply, it will not match and will not appear in Slack.

2. **Static data is per n8n instance.** If the n8n instance restarts and static data is lost, previously stored `conversationId → threadTs` mappings are gone. Incoming Branch A re-populates the mapping for new emails; old conversations need a manual re-run of Branch A.

3. **Sent Items polling delay.** Branch B polls every minute, so there may be up to 60 seconds between the manager sending and the thread reply appearing in Slack.

4. **Subject filter is exact.** Only emails with subject exactly equal to `Tooba Feedback` (case-insensitive) pass Branch A. Subjects like `Tooba Feedback response`, `Tooba Feedback #123`, or `Re: Tooba Feedback` are all blocked.
