# Diagnostic Report — Tooba Support AI Workflow

**Date:** 2026-05-06  
**Workflow ID:** C75QliFmfATEJIct  
**Baseline:** `n8n/workflow.original.json` (commit from branch `claude/n8n-email-automation-YRJs4`)

---

## API Access

| Endpoint | Status |
|---|---|
| `GET https://n8n.tooba.com/healthz` | **403 Host not in allowlist** |
| `GET https://n8n.tooba.com/api/v1/workflows/C75QliFmfATEJIct` | **403 Host not in allowlist** |

**Root cause:** n8n instance restricts incoming connections by IP/origin. The automation environment's IP is not in the n8n allowlist (`N8N_ALLOWED_ORIGINS` or equivalent). The API key is syntactically valid (JWT format). This does **not** affect the workflow fix — the JSON can be imported manually or via a PUT request run from the user's own machine.

**Workaround:** User uploads `n8n/workflow.fixed.json` manually via n8n UI → Workflows → Import from File, or runs the PUT from a whitelisted host.

---

## Node Inventory

| Node | Type | Issues Found |
|---|---|---|
| 🔔 Outlook Trigger | microsoftOutlookTrigger v1 | Subject filter not set (was blank, not "Tooba Feedback") |
| ⚙️ Config | code v2 | OK — slackChannelId correctly set |
| 📧 Normalize Email | code v2 | **6 issues** — see A below |
| _(missing)_ | if | **Skip Check node absent** — no branch for drafts/own emails/duplicates |
| 💬 Post to Slack | slack v2 | OK — channel from Config; `ts` captured downstream |
| 🤖 Build AI Prompt | code v2 | **2 issues** — see D below |
| 🌐 Call OpenAI API | httpRequest v4.2 | **3 issues** — see E below |
| 🔍 Extract AI Reply | code v2 | **3 issues** — see F below |
| 📝 Create Outlook Draft | httpRequest v4.2 | **2 issues** — see G below |
| _(missing)_ | httpRequest | **PATCH step absent** — draft body never updated with HTML |
| 🗂️ Map Outlook Draft ID | code v2 | Output field mismatch (`draftReply` vs `aiReply`) |
| 🧵 Slack Thread: AI Draft | slack v2 | References wrong field (`$json.draftReply`), missing status line |
| ❌ Slack: OpenAI Error | slack v2 | Error text imprecise; missing "Ручной ответ требуется" |
| ❌ Slack: Outlook Error | slack v2 | References wrong field (`draftReply`); missing AI draft text |

---

## Issues by Node

### A. 📧 Normalize Email — 6 issues

| # | Severity | Issue |
|---|---|---|
| A1 | **HIGH** | Missing `internetMessageId`, `receivedDateTime`, `rawBodyHtml`, `skip`, `skipReason` fields in output |
| A2 | **HIGH** | No skip logic: drafts (`isDraft=true`) are processed |
| A3 | **HIGH** | No skip for own emails: replies from `support@tooba.com` are processed |
| A4 | **HIGH** | No dedup: the same email can be processed multiple times if the trigger fires again before being marked |
| A5 | **MEDIUM** | `senderName`/`senderEmail` falls back to `'Unknown Sender'` / `null` if `from.emailAddress` is nested differently (e.g., `item.sender.emailAddress`) — partial handling present but not exhaustive |
| A6 | **MEDIUM** | No skip for `subject` starting with "Re:" / "Ответить:" from own address |

### D. 🤖 Build AI Prompt — 2 issues

| # | Severity | Issue |
|---|---|---|
| D1 | **MEDIUM** | System prompt does not forbid filler phrases ("Вот черновик:", "Добрый день, предлагаю:") |
| D2 | **MEDIUM** | System prompt does not require the closing signature "С уважением, Команда поддержки Tooba" |

Output shape change: was `messages` (array) → now `systemPrompt` + `userPrompt` (strings). This gives cleaner separation for the HTTP Request body expression.

### E. 🌐 Call OpenAI API — 3 issues

| # | Severity | Issue |
|---|---|---|
| E1 | **HIGH** | `retryOnFail` not set → single HTTP call; a 429 immediately routes to error output and posts "OpenAI не сгенерировал черновик" to Slack without retrying |
| E2 | **LOW** | `temperature: 0` (spec requires 0.1) |
| E3 | **LOW** | `max_tokens: 1000` (spec requires 900) |

### F. 🔍 Extract AI Reply — 3 issues

| # | Severity | Issue |
|---|---|---|
| F1 | **HIGH** | Does not detect 429 / rate-limit errors in response body (`response.error`) |
| F2 | **MEDIUM** | Only checks `choices[0].message.content`; ignores `output_text`, `message.content`, `text` shapes |
| F3 | **LOW** | Output field is `draftReply` — renamed to `aiReply` in v2 for clarity |

### G. 📝 Create Outlook Draft — 2 issues

| # | Severity | Issue |
|---|---|---|
| G1 | **HIGH** | Creates a reply draft with `contentType: "Text"` in the POST body. Outlook shows the draft as plain text, stripping formatting. Spec requires `contentType: "HTML"` |
| G2 | **HIGH** | No PATCH step to update draft body separately. Many Outlook clients (including mobile) do not reliably show bodies set inside the `createReply` JSON when both the `message.body` and the graph response are inconsistent. A separate PATCH to `/messages/{draftId}` is the robust pattern |

### Connection issues

| # | Severity | Issue |
|---|---|---|
| C1 | **HIGH** | Normalize Email → Post to Slack (direct) — no IF/Skip node in between. Own emails, drafts, and duplicates reach Slack and trigger OpenAI calls |
| C2 | **HIGH** | No `🖊️ Update Draft Body` node in workflow |

---

## Summary by Severity

| Severity | Count |
|---|---|
| HIGH | 9 |
| MEDIUM | 5 |
| LOW | 3 |
| **Total** | **17** |
