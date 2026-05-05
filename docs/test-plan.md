# Test Plan — Tooba Support AI n8n Automation

## Test environment

- n8n self-hosted 2.15.0
- Workflow: **Tooba Support AI – Email Processing**
- Slack channel: `#support_ai_test`
- Target mailbox: `support@tooba.com`

---

## TC-01 — Happy path: FAQ match

**Objective:** Verify the full flow with an email whose topic matches the FAQ.

**Steps:**
1. Send an email to `support@tooba.com`:
   - Subject: `Вопрос о тарифах`
   - Body: `Здравствуйте! Расскажите, какие у вас тарифные планы и сколько они стоят?`
2. Wait up to 60 seconds (one poll cycle).

**Expected results:**

| # | Check | Pass condition |
|---|---|---|
| 1 | Slack main message appears in `#support_ai_test` | Message contains sender name, email, subject, and body text |
| 2 | Slack thread reply appears under main message | Reply contains `🤖 ЧЕРНОВИК ОТВЕТА:` and AI-generated text |
| 3 | AI reply is relevant to FAQ topic | Reply references Starter/Business/Enterprise plans |
| 4 | Reply does NOT contain `Нет подходящего ответа` | Correct: FAQ match was found |
| 5 | Outlook draft exists | Go to Drafts folder of `support@tooba.com`; draft is present and unsent |
| 6 | Slack thread contains `Draft ID:` | Draft ID is a non-empty string |

---

## TC-02 — No FAQ match

**Objective:** Verify the exact fallback phrase when the AI cannot answer.

**Steps:**
1. Send an email to `support@tooba.com`:
   - Subject: `Вопрос о блокчейн интеграции`
   - Body: `Как мне настроить смарт-контракты в Tooba?`
2. Wait up to 60 seconds.

**Expected results:**

| # | Check | Pass condition |
|---|---|---|
| 1 | Slack main message appears | ✓ |
| 2 | AI draft in Slack thread contains **exactly**: `Нет подходящего ответа — требуется проверка менеджера.` | Byte-exact match (no extra text, no paraphrase) |
| 3 | Outlook draft contains the same fallback phrase | ✓ |

---

## TC-03 — HTML email body

**Objective:** Verify HTML stripping works correctly.

**Steps:**
1. Send an HTML-formatted email with bold text, links, and `<br>` tags.
2. Wait for the workflow to process.

**Expected results:**

| # | Check | Pass condition |
|---|---|---|
| 1 | Slack main message shows clean plain text | No `<b>`, `<a href=...>`, `<br>` tags visible |
| 2 | `cleanBody` does not contain raw HTML | Inspect n8n execution log |

---

## TC-04 — OpenAI error handling

**Objective:** Verify the workflow handles OpenAI failure gracefully.

**Steps:**
1. Temporarily set an invalid OpenAI API key in the credential.
2. Send a test email.
3. Restore the correct API key after the test.

**Expected results:**

| # | Check | Pass condition |
|---|---|---|
| 1 | Slack main message still appears | Flow does not stop before Slack post |
| 2 | Slack thread reply says: `⚠️ Ошибка: OpenAI не сгенерировал черновик.` | Error branch fires |
| 3 | No Outlook draft is created | Draft creation node is not reached |
| 4 | n8n execution shows error on `🌐 Call OpenAI API` node | Inspect Executions tab |

---

## TC-05 — Outlook draft creation error handling

**Objective:** Verify the workflow handles Graph API failure gracefully.

**Steps:**
1. In the `📝 Create Outlook Draft` node, temporarily change the URL to an invalid one.
2. Send a test email.
3. Restore the correct URL after the test.

**Expected results:**

| # | Check | Pass condition |
|---|---|---|
| 1 | Slack main message appears | ✓ |
| 2 | AI draft text is posted in Slack thread with error message | Thread contains `⚠️ Ошибка: черновик в Outlook не создан.` |
| 3 | AI draft content is also included in the error thread message | Reviewers can manually use the text |
| 4 | Execution shows error on `📝 Create Outlook Draft` node | ✓ |

---

## TC-06 — Missing sender

**Objective:** Verify graceful handling of emails with no sender field.

**Steps:**
1. In n8n, manually trigger the workflow with a test payload that has no `from` or `sender` fields.
2. Use n8n's **Test workflow** / **Pin data** feature to inject a mock email.

**Expected results:**

| # | Check | Pass condition |
|---|---|---|
| 1 | Workflow does not crash | No fatal error on `📧 Normalize Email` |
| 2 | Slack main message shows `Unknown Sender` | ✓ |
| 3 | `_warnings` field in execution data mentions `senderEmail missing` | Visible in n8n execution log |

---

## TC-07 — Missing messageId

**Objective:** Verify the workflow handles an email without an `id` field.

**Steps:**
1. Use n8n Pin data to inject a mock email with no `id` field.

**Expected results:**

| # | Check | Pass condition |
|---|---|---|
| 1 | Normalize Email warns about missing messageId | `_warnings` contains `messageId missing` |
| 2 | Outlook draft creation fails gracefully | Error branch fires, Slack thread shows `⚠️ Ошибка: черновик в Outlook не создан.` |

---

## TC-08 — Security: no secrets in repo

**Objective:** Verify the security scanner catches no real secrets.

**Steps:**
```bash
npm run validate
```

**Expected results:**

| # | Check | Pass condition |
|---|---|---|
| 1 | Exit code 0 | ✓ |
| 2 | `No secret patterns found` | ✓ |
| 3 | Workflow JSON parses without error | ✓ |

---

## Acceptance criteria summary

| Criterion | TC |
|---|---|
| Workflow imports without JSON parse errors | TC-08 |
| No real secrets in repo | TC-08 |
| One email → Slack main message | TC-01 |
| One email → Slack thread with AI draft | TC-01 |
| One email → Outlook draft (unsent) | TC-01 |
| FAQ no-match → exact fallback phrase | TC-02 |
| HTML body → clean plain text in Slack | TC-03 |
| OpenAI failure → Slack thread error | TC-04 |
| Outlook failure → Slack thread error | TC-05 |
| Missing sender → no crash | TC-06 |
| Missing messageId → graceful degradation | TC-07 |
