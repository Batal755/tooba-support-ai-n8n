# n8n Test Plan — Tooba Support AI Workflow v2

**Workflow file:** `n8n/workflow.fixed.json`  
**Target n8n instance:** `https://n8n.tooba.com`  
**Workflow ID:** `C75QliFmfATEJIct`

---

## Pre-test checklist

Before running any test case, confirm all of the following:

- [ ] Workflow imported from `n8n/workflow.fixed.json`
- [ ] Workflow is **inactive** (do not activate until all manual tests pass)
- [ ] All 8 credentials linked in the UI (see table below)
- [ ] Bot invited to `#support_ai_test` channel
- [ ] n8n execution log is open (n8n → Executions) to observe each run

### Credential assignment

| Node | Credential type |
|---|---|
| 🔔 Outlook Trigger | microsoftOutlookOAuth2Api |
| 📝 Create Outlook Draft | microsoftOutlookOAuth2Api |
| 🖊️ Update Draft Body | microsoftOutlookOAuth2Api |
| 🌐 Call OpenAI API | openAiApi (new key — not OLD_OpenAi account) |
| 💬 Post to Slack | slackApi |
| 🧵 Slack Thread: AI Draft | slackApi |
| ❌ Slack: OpenAI Error | slackApi |
| ❌ Slack: Outlook Error | slackApi |

---

## Test cases

---

### TC-01 — Normal inbound email (happy path)

**Goal:** Full end-to-end flow produces Slack message, OpenAI draft, and Outlook draft.

**Steps:**
1. Send an email to `support@tooba.com` with subject containing "Tooba Feedback" and a body of at least 10 characters.
2. Wait up to 60 seconds (one poll cycle).
3. In n8n → Executions, open the execution.

**Expected results:**

| Step | Expected |
|---|---|
| 🔔 Outlook Trigger | Fires; item has `isDraft: false` |
| ⚙️ Config | Outputs `slackChannelId` |
| 📧 Normalize Email | `skip: false`; `messageId` not null; `senderEmail` is sender's address; `cleanBody` ≥ 10 chars |
| 🚦 Skip Check | Routes to FALSE output (index 1) → 💬 Post to Slack |
| 💬 Post to Slack | Message visible in `#support_ai_test`; response contains `ts` |
| 🤖 Build AI Prompt | `systemPrompt` and `userPrompt` are non-empty strings |
| 🌐 Call OpenAI API | HTTP 200; response body has `choices[0].message.content` |
| 🔍 Extract AI Reply | `aiReply` is non-empty; `aiError: false` |
| 📝 Create Outlook Draft | HTTP 201; response has `id` (draftId) |
| 🖊️ Update Draft Body | HTTP 200; response has `id`; body was patched to HTML |
| 🗂️ Map Outlook Draft ID | `outlookDraftId` set; `outlookBodyUpdated: true`; `outlookCreated: true` |
| 🧵 Slack Thread: AI Draft | Thread reply in `#support_ai_test` with `aiReply` text and Draft ID line |

**Verify in Outlook Drafts:**
- An unsent reply draft exists in the Drafts folder for `support@tooba.com`.
- The draft is linked to the original email thread.
- The body renders in HTML (not plain text).
- The draft ends with "С уважением, Команда поддержки Tooba".

**Verify in Slack thread:**
```
🤖 ЧЕРНОВИК ОТВЕТА:
<ai reply text>

Статус:
✅ Черновик создан в Outlook. Draft ID: <id>
```

---

### TC-02 — Skip: own email (support@tooba.com sender)

**Goal:** Emails sent from the support address itself are silently dropped.

**Steps:**
1. In n8n, open `📧 Normalize Email` and test it manually by injecting a mock item with `from.emailAddress.address = "support@tooba.com"`.
2. Alternatively, send an email **from** `support@tooba.com` to itself (requires access to the mailbox).

**Expected results:**

| Step | Expected |
|---|---|
| 📧 Normalize Email | `skip: true`; `skipReason: "sender is support@tooba.com"` |
| 🚦 Skip Check | Routes to TRUE output (index 0) — dead end; no further nodes execute |
| 💬 Post to Slack | **Not called** |
| All downstream | **Not called** |

---

### TC-03 — Skip: draft item (`isDraft: true`)

**Goal:** Outlook draft items are not processed.

**Steps:**
1. Test `📧 Normalize Email` manually with a mock item that has `isDraft: true`.

**Expected results:**

| Step | Expected |
|---|---|
| 📧 Normalize Email | `skip: true`; `skipReason: "item is a draft"` |
| 🚦 Skip Check | Routes to TRUE output → dead end |

---

### TC-04 — Skip: duplicate email (same messageId)

**Goal:** The same email triggered twice is only processed once.

**Steps:**
1. Trigger the workflow on a real email (TC-01 succeeds).
2. Manually re-trigger the workflow on the **same email** (use n8n "Test step" or re-run the execution with the same input).

**Expected results on second run:**

| Step | Expected |
|---|---|
| 📧 Normalize Email | `skip: true`; `skipReason: "duplicate — already processed"` |
| 🚦 Skip Check | Routes to TRUE output → dead end |
| 💬 Post to Slack | **Not called** — no duplicate Slack message |

---

### TC-05 — Skip: empty body (`cleanBody < 3 chars`)

**Goal:** Emails with no meaningful content are dropped.

**Steps:**
1. Test `📧 Normalize Email` manually with a mock item whose body is empty or whitespace only.

**Expected results:**

| Step | Expected |
|---|---|
| 📧 Normalize Email | `skip: true`; `skipReason: "cleanBody < 3 chars"` |
| 🚦 Skip Check | Routes to TRUE output → dead end |

---

### TC-06 — Skip: `Re:` / `Ответить:` subject from own address

**Goal:** Reply-chain emails from the support address are not re-processed.

**Steps:**
1. Test `📧 Normalize Email` manually with:
   - `subject: "Re: Tooba Feedback"`
   - `from.emailAddress.address: "support@tooba.com"`

**Expected results:**

| Step | Expected |
|---|---|
| 📧 Normalize Email | `skip: true`; `skipReason` mentions "own email" or "reply" |
| 🚦 Skip Check | Routes to TRUE output → dead end |

---

### TC-07 — Missing messageId (no id field in trigger payload)

**Goal:** Items without a messageId produce a `_warnings` field but still skip gracefully.

**Steps:**
1. Test `📧 Normalize Email` manually with a mock item that has no `id` and no `messageId` field.

**Expected results:**

| Step | Expected |
|---|---|
| 📧 Normalize Email | `skip: true`; `skipReason: "messageId missing"` |
| 🚦 Skip Check | Routes to TRUE output → dead end |

---

### TC-08 — OpenAI retry on 429

**Goal:** A transient 429 rate-limit error is retried automatically up to 3 times.

**Note:** This test requires temporarily pointing `🌐 Call OpenAI API` at a mock endpoint that returns 429, or observing a real 429 in logs.

**Expected results:**

| Attempt | Expected |
|---|---|
| 1st call → 429 | n8n waits 5000 ms, retries automatically |
| 2nd call → 429 | n8n waits 5000 ms, retries automatically |
| 3rd call → 200 | Continues to `🔍 Extract AI Reply` normally |
| 3 × 429 | Routes to `❌ Slack: OpenAI Error` after all retries exhausted |

**Also verify in `🔍 Extract AI Reply`:** If the `response.error` field contains a rate-limit code, `aiReply` = `"Нет подходящего ответа — требуется проверка менеджера. Причина: OpenAI rate limit."` and `aiError: true`.

---

### TC-09 — OpenAI credential error (wrong key)

**Goal:** Invalid OpenAI credential posts an error to Slack instead of silently failing.

**Steps:**
1. Temporarily set `🌐 Call OpenAI API` to use an invalid credential.
2. Trigger the workflow with a normal email.

**Expected results:**

| Step | Expected |
|---|---|
| 🌐 Call OpenAI API | Error output fires after 3 retries |
| ❌ Slack: OpenAI Error | Message in `#support_ai_test`: includes "OpenAI не сгенерировал черновик", `error.message`, and "Ручной ответ требуется" |
| Outlook Draft | Not created |

---

### TC-10 — Outlook credential error (Draft creation fails)

**Goal:** When `📝 Create Outlook Draft` fails, an error is posted to Slack with the AI draft text.

**Steps:**
1. Temporarily revoke or expire the Microsoft OAuth credential.
2. Trigger the workflow with a normal email.

**Expected results:**

| Step | Expected |
|---|---|
| 📝 Create Outlook Draft | Error output fires (onError: continueErrorOutput) |
| ❌ Slack: Outlook Error | Message in `#support_ai_test`: includes "Outlook draft не создан", `error.message`, and the full `aiReply` text |
| 🧵 Slack Thread: AI Draft | **Not called** |

---

### TC-11 — PATCH body soft failure (Update Draft Body fails)

**Goal:** When the PATCH step fails, the workflow continues and the Map node falls back to the POST id.

**Steps:**
1. Temporarily modify `🖊️ Update Draft Body` URL to an invalid endpoint.
2. Trigger the workflow with a normal email.

**Expected results:**

| Step | Expected |
|---|---|
| 📝 Create Outlook Draft | Succeeds; draftId obtained |
| 🖊️ Update Draft Body | Fails (onError: continueRegularOutput — continues chain) |
| 🗂️ Map Outlook Draft ID | `outlookDraftId` = id from POST (fallback); `outlookBodyUpdated: false` |
| 🧵 Slack Thread: AI Draft | Posted with `aiReply`; Draft ID line shows POST draftId |

---

### TC-12 — Outlook Trigger subject filter

**Goal:** Only emails with "Tooba Feedback" in the subject trigger the workflow.

**Steps:**
1. Send an email to `support@tooba.com` with subject **not** containing "Tooba Feedback" (e.g., "Hello").
2. Wait 60 seconds.

**Expected results:**
- No new execution appears in n8n → Executions.
- No Slack message.

---

### TC-13 — Slack thread format verification

**Goal:** Confirm the thread reply matches the exact spec format.

**Trigger:** Run TC-01 successfully.

**Expected Slack thread reply format:**
```
🤖 ЧЕРНОВИК ОТВЕТА:
<one or more lines of AI reply>

Статус:
✅ Черновик создан в Outlook. Draft ID: <outlook-draft-id>
```

If Outlook draft creation failed:
```
🤖 ЧЕРНОВИК ОТВЕТА:
<ai reply>

Статус:
❌ Черновик Outlook не создан.
```

---

### TC-14 — AI signature in draft

**Goal:** AI reply always ends with the required signature.

**Trigger:** Run TC-01 successfully.

**Expected:** The `aiReply` text ends with:
```
С уважением, Команда поддержки Tooba
```

---

### TC-15 — No filler phrases in AI reply

**Goal:** AI reply does not start with banned filler phrases.

**Expected:** `aiReply` does NOT start with:
- "Вот черновик:"
- "Добрый день, предлагаю:"
- "Конечно!"
- Similar introductory filler

---

## Acceptance criteria

All 15 test cases must pass before the workflow is activated in production.

| # | Test case | Status |
|---|---|---|
| TC-01 | Happy path | ⬜ |
| TC-02 | Skip own email | ⬜ |
| TC-03 | Skip draft | ⬜ |
| TC-04 | Skip duplicate | ⬜ |
| TC-05 | Skip empty body | ⬜ |
| TC-06 | Skip Re: from own address | ⬜ |
| TC-07 | Missing messageId | ⬜ |
| TC-08 | OpenAI 429 retry | ⬜ |
| TC-09 | OpenAI credential error | ⬜ |
| TC-10 | Outlook credential error | ⬜ |
| TC-11 | PATCH soft failure | ⬜ |
| TC-12 | Subject filter | ⬜ |
| TC-13 | Slack thread format | ⬜ |
| TC-14 | AI signature | ⬜ |
| TC-15 | No filler phrases | ⬜ |
