# Test Plan — outlook_slack_n8n_08.05.26 v4

**File:** `n8n/workflow.final-reply-to-slack-thread.v4.json`  
**Channel:** `#support_ai_test` (`C0ATU9ZD2UF`)

---

## Pre-test checklist

- [ ] v4 imported and **inactive** during manual tests
- [ ] All previous workflow versions deactivated
- [ ] Outlook credential linked to both trigger nodes
- [ ] Slack credential linked to both Slack nodes
- [ ] Bot invited to `#support_ai_test`
- [ ] n8n → Executions open for observation

---

## TC-01 — Incoming Tooba Feedback posts main Slack message

**Steps:**
1. Send email to `support@tooba.com`, subject exactly `Tooba Feedback`, body ≥ 10 chars.
2. Wait up to 60 s.

**Expected:**

| Node | Result |
|---|---|
| 📧 Normalize Incoming Email | Returns item (not `[]`); `senderEmail` set; `conversationId` set |
| 💬 Post Request to Slack | Message in `#support_ai_test`; has `ts` |
| 🧷 Store Slack Thread Mapping | Returns `{ ok: true, conversationId, threadTs }` |

**Expected Slack main message:**
```
ID обращения: —
Email: customer@example.com
Тема: Tooba Feedback
Сообщение: <customer message text>
```

---

## TC-02 — Re: Tooba Feedback does NOT create main Slack message

**Steps:**
1. Send email to `support@tooba.com` with subject `Re: Tooba Feedback`.
2. Wait 60 s.

**Expected:**
- `📧 Normalize Incoming Email` returns `[]` — subject is `re: tooba feedback`, not `tooba feedback`.
- Execution stops at `📧 Normalize Incoming Email`.
- **No new Slack message** in `#support_ai_test`.

Also test with:
- `Ответить: Tooba Feedback` → `[]`
- `FW: Tooba Feedback` → `[]`
- `Tooba Feedback — follow-up` → `[]`
- `Tooba feedback response` → `[]`

---

## TC-03 — No UNKNOWN sender when replyTo / ccRecipients / body has real email

**Steps:**
1. Send Tooba Feedback where the `from` field is a relay (`no-reply@mx.tooba.com`) but `replyTo` or `ccRecipients` contains the real customer email.

**Expected:**
- `senderEmail` = real customer email (not `unknown`, not `no-reply@mx.tooba.com`).
- Slack card shows correct `Email:` line.

---

## TC-04 — Manager sends reply in Outlook

**Pre-condition:** TC-01 completed; `conversationId` stored in static data.

**Steps:**
1. Open original customer email in Outlook for `support@tooba.com`.
2. Click **Reply** (same thread — same `conversationId`).
3. Write reply text ≥ 10 chars.
4. Click **Send**.
5. Wait up to 60 s.

**Expected:**

| Node | Result |
|---|---|
| 📧 Normalize Sent Reply | Returns item; `sentReplyText` set; `slackThreadTs` set |
| 🔎 Find Slack Thread Mapping | Passes through |
| 🧵 Post Final Reply to Slack Thread | Posted in thread |

---

## TC-05 — Sent reply appears in Slack thread

**Expected Slack thread reply:**
```
✅ Ответ менеджера отправлен в Outlook
Кому: customer@example.com
Текст ответа:
<manager reply text — no quoted history>
```

**Verify:**
- Appears under the TC-01 main card as a thread reply.
- Quoted email history (everything after `От:`, `From:`, `--- Original Message ---`) is stripped.
- Outlook mobile footer stripped.

---

## TC-06 — Sent reply does NOT appear as new main channel message

**Expected:**
- Main `#support_ai_test` timeline: only TC-01 card visible.
- Manager reply visible only inside the thread of that card.

---

## TC-07 — Duplicate sent item does not duplicate thread reply

**Steps:**
1. Note `messageId` of the sent reply from TC-04.
2. Re-run Branch B with the same payload (n8n "Test step").

**Expected:**
- `📧 Normalize Sent Reply` returns `[]` — messageId already in `processedSentMessageIds`.
- No duplicate Slack thread reply.

---

## Acceptance criteria

| # | Test case | Status |
|---|---|---|
| TC-01 | Incoming Tooba Feedback → main Slack card | ⬜ |
| TC-02 | Re: Tooba Feedback → no Slack card | ⬜ |
| TC-03 | No UNKNOWN sender | ⬜ |
| TC-04 | Manager sends reply → Branch B detects it | ⬜ |
| TC-05 | Sent reply in Slack thread | ⬜ |
| TC-06 | Sent reply NOT in main channel | ⬜ |
| TC-07 | Duplicate dedup works | ⬜ |

---

## Known limitations

1. **Manager must reply in the same Outlook thread** (click Reply, not New Email).
2. **Static data is per n8n instance** — lost on restart; new incoming emails re-populate the mapping automatically.
3. **Sent Items polling delay** — up to 60 seconds between send and Slack thread reply.
4. **Exact subject required** — only `Tooba Feedback` (any capitalisation) triggers Branch A.
