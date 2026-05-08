# Changelog — Tooba Support AI n8n Workflow

---

## [3.1.0] — 2026-05-08 — HOTFIX v4

### outlook_slack_n8n_08.05.26 v4 (new file)

**File:** `n8n/workflow.final-reply-to-slack-thread.v4.json`

**Bug fixed:** Branch A was processing `Re: Tooba Feedback` emails and posting empty cards to Slack (empty sender, empty body). Root cause: subject filter was `includes('tooba feedback')` instead of exact match.

**Fix:** `📧 Normalize Incoming Email` now uses hard-stop `subjectNormalized !== 'tooba feedback'` → `return []`. Any prefix (`Re:`, `Ответить:`, `Fwd:`, `FW:`) causes the entire branch to stop immediately — Slack is never called.

**Other changes vs v1:**
- `requestId` defaults to `'—'` instead of `''`
- `cleanBody` strips `OpenAI не сгенерировал…` artifacts from older workflow executions
- `🧷 Store Slack Thread Mapping` simplified — removed `processedIncomingMessageIds` ring-buffer (not needed since exact-subject filter prevents most duplicates)
- No IF nodes, no shouldPost flags — pure `return []` pattern throughout
- Workflow name: `outlook_slack_n8n_08.05.26 v4`

**Docs:**
- `docs/FINAL_REPLY_THREAD_V4_IMPORT.md`
- `docs/FINAL_REPLY_THREAD_V4_TEST_PLAN.md` (TC-01 through TC-07)

---

## [3.0.0] — 2026-05-07

### Final Reply to Slack Thread workflow (new file)

**File:** `n8n/workflow.final-reply-to-slack-thread.v1.json`  
**Name:** Tooba Support Final Reply to Slack Thread v1

Complete architecture change — removes OpenAI and Outlook Draft; adds Sent Items monitoring.

**Branch A — Incoming email (4 nodes):**
- 🔔 Inbox Outlook Trigger — polls Inbox every minute, Raw output
- 📧 Normalize Incoming Email — exact subject filter (`tooba feedback`), multi-path sender extraction (replyTo → cc → explicit Email: line → embedded → from), extracts requestId, strips technical lines; returns `[]` for invalid emails
- 💬 Post Request to Slack — card format: `ID обращения / Email / Тема / Сообщение`
- 🧷 Store Slack Thread Mapping — saves `conversationId → { channelId, threadTs, … }` in `$getWorkflowStaticData('global')`, dedup ring-buffer (500 IDs)

**Branch B — Sent reply (4 nodes):**
- 📤 Sent Outlook Trigger — polls SentItems every minute, Raw output
- 📧 Normalize Sent Reply — matches conversationId from staticData, strips quoted reply history via `stripQuotedHistory()`, dedup ring-buffer (500 IDs); returns `[]` if no match or already processed
- 🔎 Find Slack Thread Mapping — validates channelId / threadTs / sentReplyText before Slack post
- 🧵 Post Final Reply to Slack Thread — posts in thread via `thread_ts`, format: `✅ Ответ менеджера отправлен / Кому / Текст ответа`

**No OpenAI. No Outlook Draft. No automated email sending.**

**Docs added:**
- `docs/FINAL_REPLY_THREAD_IMPORT.md` — import guide, credential setup, Sent Items folder note, critical limitation
- `docs/FINAL_REPLY_THREAD_TEST_PLAN.md` — 7 test cases (TC-01 through TC-07)

---

## [2.1.0] — 2026-05-07

### Slack MVP workflow (new file)

**File:** `n8n/workflow.slack-mvp.fixed.json`  
**Name:** Tooba Support AI Slack MVP 07.05

Simplified 9-node workflow: Outlook → Normalize → IF skip → Slack card → Build AI Prompt → OpenAI → Extract Reply → Slack thread. No Outlook Draft, no fake FAQ.

---

## [2.0.0] — 2026-05-06

### Summary

Complete rewrite of `📧 Normalize Email`, new `🚦 Skip Check` guard node, two-step Outlook draft (POST + PATCH), OpenAI retry and 429 handling, updated Slack thread format, and improved error nodes. 17 bugs fixed (9 HIGH, 5 MEDIUM, 3 LOW). Workflow file: `n8n/workflow.fixed.json`.

---

### A — 📧 Normalize Email (complete rewrite)

**Added output fields:**
- `internetMessageId` — MIME Message-ID header from Outlook
- `receivedDateTime` — falls back to `createdDateTime` if absent
- `rawBodyHtml` — full HTML body from `item.body.content`
- `skip` (boolean) — true if this item should be dropped
- `skipReason` (string) — human-readable reason for skip

**Fixed field extraction:**
- `messageId`: now checks `item.id || item.messageId` (was only `email.id`)
- `senderEmail`: checks `from.emailAddress`, `sender.emailAddress`, `from` directly, with `.address || .email || .emailAddress` fallbacks
- `senderName`: falls back through `displayName`, then `senderEmail`, then `'Unknown Sender'`

**Added skip logic (in priority order):**
1. `messageId` missing → skip (reason: "messageId missing")
2. `isDraft === true` → skip (reason: "item is a draft")
3. sender includes `support@tooba.com` → skip (reason: "sender is support@tooba.com")
4. subject starts with `Re:` or `Ответить:` AND sender is `support@tooba.com` → skip
5. `cleanBody.length < 3` → skip (reason: "cleanBody < 3 chars")
6. `messageId` in `processedIds` → skip (reason: "duplicate — already processed")

**Added deduplication** via `$getWorkflowStaticData('global').processedIds` (ring buffer, max 500 IDs, persists across executions).

---

### B — 🚦 Skip Check (new node)

**Added** `n8n-nodes-base.if` (typeVersion 2) node between `📧 Normalize Email` and `💬 Post to Slack`.

- Condition: `$json.skip === true`
- TRUE output (0): dead end — no Slack message, no OpenAI call, no Outlook draft
- FALSE output (1): continues to `💬 Post to Slack`

**Connection change:**
- Before: `📧 Normalize Email → 💬 Post to Slack`
- After: `📧 Normalize Email → 🚦 Skip Check → [false] → 💬 Post to Slack`

---

### C — 🔔 Outlook Trigger subject filter

- Before: `filters.subject: ""` (all emails)
- After: `filters.subject: "Tooba Feedback"` (only relevant emails)

---

### D — 🤖 Build AI Prompt

**System prompt additions:**
- Rule 4: "НЕ ПИШИ вводные фразы: 'Вот черновик:', 'Добрый день, предлагаю:' и подобные."
- Rule 7: "В конце ВСЕГДА добавляй подпись: С уважением, Команда поддержки Tooba"

**Output shape change:**
- Before: `{ messages: [{role, content}, …], email }`
- After: `{ systemPrompt: string, userPrompt: string, email }`

---

### E — 🌐 Call OpenAI API

- Added `retryOnFail: true`, `maxTries: 3`, `waitBetweenTries: 5000` (5 s between retries)
- `temperature`: 0 → 0.1
- `max_tokens`: 1000 → 900
- Request body updated to use `systemPrompt` + `userPrompt` fields: `{ messages: [{ role: "system", content: $json.systemPrompt }, { role: "user", content: $json.userPrompt }] }`
- Node note added: "If credential is named 'OLD_OpenAi account', do NOT use it — old key may be compromised."

---

### F — 🔍 Extract AI Reply

**Added 429 / rate-limit detection** from `response.error` field:
- Checks `error.code`, `error.type`, `error.status`, and `error.message` for rate-limit indicators
- Sets `aiReply = "Нет подходящего ответа — требуется проверка менеджера. Причина: OpenAI rate limit."` when detected
- Sets `aiError: true`

**Added multi-format response extraction:**
```
response?.choices?.[0]?.message?.content   (standard OpenAI)
|| response?.output_text                    (n8n AI node shape)
|| response?.message?.content              (alternative)
|| response?.text                          (plain text fallback)
|| ''
```

**Output field rename:** `draftReply` → `aiReply` (all downstream nodes updated).

---

### G — 📝 Create Outlook Draft + 🖊️ Update Draft Body (two-step)

**Step 1 — `📝 Create Outlook Draft` (POST, unchanged endpoint):**
- Creates reply draft via `POST .../messages/{messageId}/createReply`
- Body: `{}` (empty — obtains draftId from response)
- `onError: continueErrorOutput` → routes to `❌ Slack: Outlook Error` on failure

**Step 2 — `🖊️ Update Draft Body` (new PATCH node):**
- Updates draft body via `PATCH .../messages/{draftId}`
- Body: `{ body: { contentType: "HTML", content: "<div style='font-family:Arial,sans-serif'>…</div>" } }`
- HTML conversion: `aiReply.split('\n').join('<br>')`
- `onError: continueRegularOutput` (soft failure — workflow continues; Map node falls back to POST id)

---

### H — 🗂️ Map Outlook Draft ID

- Now reads from `🖊️ Update Draft Body` (PATCH result), falls back to `📝 Create Outlook Draft` (POST result)
- Added `outlookBodyUpdated` boolean to output
- Output field: `draftReply` → `aiReply` (renamed to match Extract AI Reply)

---

### I — 🧵 Slack Thread: AI Draft

**Updated text format:**
```
🤖 ЧЕРНОВИК ОТВЕТА:
{aiReply}

Статус:
✅ Черновик создан в Outlook. Draft ID: {outlookDraftId}
```
Or if draft failed:
```
❌ Черновик Outlook не создан.
```

- Field reference: `$json.draftReply` → `$json.aiReply`

---

### J — ❌ Slack: OpenAI Error

Updated message:
```
❌ OpenAI не сгенерировал черновик.
Причина: {error.message}
Ручной ответ требуется.
```

---

### K — ❌ Slack: Outlook Error

Updated message includes the AI draft text:
```
❌ Outlook draft не создан.
Причина: {error.message}

AI draft:
{$('🔍 Extract AI Reply').first().json.aiReply}
```

---

### Documentation added

| File | Description |
|---|---|
| `n8n/workflow.original.json` | Snapshot of original workflow before any fixes |
| `n8n/workflow.fixed.json` | Fixed workflow (v2) — import this |
| `n8n/src/normalize-email.code.js` | Source for `📧 Normalize Email` Code node |
| `n8n/src/build-ai-prompt.code.js` | Source for `🤖 Build AI Prompt` Code node |
| `n8n/src/extract-ai-reply.code.js` | Source for `🔍 Extract AI Reply` Code node |
| `n8n/src/map-outlook-draft-id.code.js` | Source for `🗂️ Map Outlook Draft ID` Code node |
| `docs/DIAGNOSTIC_REPORT.md` | Full audit of original workflow (17 issues) |
| `docs/FIX_PLAN.md` | Detailed patch specification (Patches A–I) |
| `docs/N8N_TEST_PLAN.md` | 15 test cases with acceptance criteria |

---

## [1.1.0] — 2026-05-05

### Config node patch

- Removed dependency on n8n Variables for `SLACK_CHANNEL_ID`
- Added `⚙️ Config` Code node with `slackChannelId: 'C0ATU9ZD2UF'` embedded directly
- All 4 Slack nodes updated to read channel from Config node via `$('⚙️ Config').first().json.slackChannelId`
- README updated: setup checklist added; clarified that Slack Channel ID is not a secret
- `scripts/validate-workflow.mjs` structural checks changed to length-bounded regex to avoid false positives from sticky note text

---

## [1.0.0] — 2026-05-04

### Initial build

- 13 files created: workflow JSON, knowledge base (FAQ), system prompt, code utilities, import/validate scripts, documentation
- Workflow nodes: Outlook Trigger, Config, Normalize Email, Post to Slack, Build AI Prompt, Call OpenAI API, Extract AI Reply, Create Outlook Draft, Map Outlook Draft ID, Slack Thread, error nodes
- Security: no secrets in files; all authentication via n8n Credentials
- `scripts/validate-workflow.mjs`: JSON validation + secret pattern scan + structural checks
- `scripts/import-to-n8n.mjs`: automated PUT import via n8n API
