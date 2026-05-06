# Fix Plan — Tooba Support AI Workflow v2

**Target file:** `n8n/workflow.fixed.json`  
**Source baseline:** `n8n/workflow.original.json`

---

## Patch A — Normalize Email (complete rewrite)

**File:** `n8n/src/normalize-email.code.js`

### Changes

| Field | Original | Fixed |
|---|---|---|
| `messageId` | `email.id \|\| null` | `item.id \|\| item.messageId \|\| null` |
| `internetMessageId` | _(absent)_ | `item.internetMessageId \|\| null` |
| `senderEmail` | `fromEmail.address \|\| null` | `fromObj.address \|\| fromObj.email \|\| fromObj.emailAddress` |
| `senderName` | `fromEmail.name \|\| 'Unknown Sender'` | Falls back through `displayName`, then `senderEmail`, then `'Unknown Sender'` |
| `receivedDateTime` | _(absent)_ | `item.receivedDateTime \|\| item.createdDateTime` |
| `rawBodyHtml` | _(absent)_ | `item.body?.content \|\| ''` |
| `skip` | _(absent)_ | boolean — see skip logic below |
| `skipReason` | _(absent)_ | string |

### Skip logic (in order)

```
if no messageId          → skip, reason: "messageId missing"
if isDraft === true      → skip, reason: "item is a draft"
if sender includes support@tooba.com → skip, reason: "own email"
if Re:/Ответить: subject AND sender = support@tooba.com → skip
if cleanBody.length < 3 → skip, reason: "cleanBody < 3 chars"
if messageId in processedIds (static data) → skip, reason: "duplicate"
else → add messageId to processedIds (keep last 500)
```

### Dedup implementation

```javascript
const sd = $getWorkflowStaticData('global');
if (!Array.isArray(sd.processedIds)) sd.processedIds = [];
if (sd.processedIds.includes(messageId)) {
  skip = true; skipReason = 'duplicate — already processed';
} else {
  sd.processedIds.push(messageId);
  if (sd.processedIds.length > 500) sd.processedIds = sd.processedIds.slice(-500);
}
```

Static data persists between executions within the same n8n instance.

---

## Patch B — Add 🚦 Skip Check (IF node)

**New node:** `n8n-nodes-base.if` typeVersion 2

```
Condition: $json.skip === true

TRUE  output (0) → no connection (dead end)
FALSE output (1) → 💬 Post to Slack
```

This means skipped items (own emails, duplicates, drafts, empty bodies) produce no Slack message, no OpenAI call, and no Outlook draft.

Connection change:
- Old: `📧 Normalize Email → 💬 Post to Slack`
- New: `📧 Normalize Email → 🚦 Skip Check → (false) → 💬 Post to Slack`

---

## Patch C — Outlook Trigger subject filter

Original had `filters.subject: ""` (empty = all emails).  
Fixed: `filters.subject: "Tooba Feedback"`.

This narrows the trigger to only emails whose subject contains "Tooba Feedback", matching the business requirement.

---

## Patch D — Build AI Prompt

**File:** `n8n/src/build-ai-prompt.code.js`

### System prompt additions

1. Added rule: _"НЕ ПИШИ вводные фразы: 'Вот черновик:', 'Добрый день, предлагаю:' и подобные."_
2. Added rule: _"В конце ВСЕГДА добавляй подпись: С уважением, Команда поддержки Tooba"_
3. TODO comment preserved: `"Вставить Copilot_FULL_QA.txt / Tooba FAQ здесь"`

### Output shape change

| Field | Original | Fixed |
|---|---|---|
| `messages` | Array `[{role,content},…]` | Removed |
| `systemPrompt` | _(absent)_ | String (full system prompt) |
| `userPrompt` | _(absent)_ | String (subject + cleanBody) |
| `email` | Object | Object (unchanged) |

The OpenAI HTTP Request node body expression is updated accordingly.

---

## Patch E — Call OpenAI API

| Setting | Original | Fixed |
|---|---|---|
| `retryOnFail` | _(absent, defaults false)_ | `true` |
| `maxTries` | _(absent)_ | `3` |
| `waitBetweenTries` | _(absent)_ | `5000 ms` |
| `temperature` | `0` | `0.1` |
| `max_tokens` | `1000` | `900` |
| body expression | `{messages: $json.messages}` | `{messages: [{role:'system', content: $json.systemPrompt}, {role:'user', content: $json.userPrompt}]}` |

Node note added: _"If credential is named 'OLD_OpenAi account', do NOT use it — old key may be compromised."_

---

## Patch F — Extract AI Reply (rewrite)

**File:** `n8n/src/extract-ai-reply.code.js`

### Multi-format extraction

```javascript
aiReply =
  response?.choices?.[0]?.message?.content ||  // standard OpenAI
  response?.output_text ||                       // n8n AI node shape
  response?.message?.content ||                 // alternative
  response?.text ||                             // plain text fallback
  '';
```

### 429 / rate-limit detection

```javascript
if (response?.error) {
  const isRateLimit =
    String(err.code || '').includes('rate_limit') ||
    String(err.type || '').includes('rate_limit') ||
    String(err.status || '').includes('429') ||
    errorMessage.toLowerCase().includes('429') ||
    errorMessage.toLowerCase().includes('rate limit') ||
    errorMessage.toLowerCase().includes('too many requests');

  aiReply = isRateLimit
    ? 'Нет подходящего ответа — требуется проверка менеджера. Причина: OpenAI rate limit.'
    : 'Нет подходящего ответа — требуется проверка менеджера.';
  aiError = true;
}
```

### Output field rename

`draftReply` → `aiReply` (all downstream references updated).

---

## Patch G — Outlook Draft (two-step)

### Step 1: `📝 Create Outlook Draft` (POST createReply)

```
POST https://graph.microsoft.com/v1.0/users/support@tooba.com/messages/{messageId}/createReply
Body: {}   ← empty JSON, gets draftId from response
onError: continueErrorOutput → ❌ Slack: Outlook Error
```

### Step 2: `🖊️ Update Draft Body` (PATCH — NEW NODE)

```
PATCH https://graph.microsoft.com/v1.0/users/support@tooba.com/messages/{draftId}
Body: { body: { contentType: "HTML", content: "<div>…aiReply…</div>" } }
onError: continueRegularOutput  ← soft failure, Map node falls back to POST id
```

HTML conversion: `aiReply.split('\n').join('<br>')` wrapped in `<div style="font-family:Arial,sans-serif">`.

The draft appears in **Outlook Drafts folder** and **Outlook mobile** as an HTML reply linked to the original email thread.

---

## Patch H — Slack Thread: AI Draft

Updated text format per spec:

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

Field reference: `$json.aiReply` (was `$json.draftReply`).

---

## Patch I — Error nodes

### ❌ Slack: OpenAI Error

```
❌ OpenAI не сгенерировал черновик.
Причина: {error.message}
Ручной ответ требуется.
```

### ❌ Slack: Outlook Error

```
❌ Outlook draft не создан.
Причина: {error.message}

AI draft:
{$('🔍 Extract AI Reply').first().json.aiReply}
```

---

## Connection map (before → after)

```
Before:
Trigger → Config → Normalize → Slack → AI Prompt → OpenAI ─┬─ Extract → Create Draft ─┬─ Map → Slack Thread
                                                             └─ Slack: OpenAI Error      └─ Slack: Outlook Error

After:
Trigger → Config → Normalize → Skip Check ─[skip=true]→ (dead end)
                                           └─[skip=false]→ Slack → AI Prompt → OpenAI ─┬─ Extract → Create Draft ─┬─ Update Body → Map → Slack Thread
                                                                                         └─ Slack: OpenAI Error      └─ Slack: Outlook Error
```

---

## Credentials to verify in n8n

| Node | Credential type | Action |
|---|---|---|
| 🔔 Outlook Trigger | `microsoftOutlookOAuth2Api` | Verify not expired; re-auth if needed |
| 📝 Create Outlook Draft | `microsoftOutlookOAuth2Api` | Same credential; confirm `Mail.ReadWrite` scope |
| 🖊️ Update Draft Body | `microsoftOutlookOAuth2Api` | Same credential |
| 🌐 Call OpenAI API | `openAiApi` | **Create NEW credential** if old key was `OLD_OpenAi account` |
| 💬 Post to Slack | `slackApi` | Bot token; verify bot in #support_ai_test |
| 🧵 Slack Thread: AI Draft | `slackApi` | Same |
| ❌ Slack: OpenAI Error | `slackApi` | Same |
| ❌ Slack: Outlook Error | `slackApi` | Same |
