// Extract and normalise AI reply from OpenAI HTTP response.
// Handles: rate limits (429), multiple response formats, empty responses.

const response = $input.first().json;
const buildData = $('🤖 Build AI Prompt').first().json;
const email = buildData.email;

let aiReply = '';
let aiError = false;
let errorMessage = '';

// ── 1. Check for explicit error object in response body ───────────────────
if (response?.error) {
  const err = response.error;
  errorMessage = err.message || JSON.stringify(err);
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

// ── 2. Try multiple response format shapes ────────────────────────────────
if (!aiReply) {
  aiReply = (
    response?.choices?.[0]?.message?.content ||
    response?.output_text ||
    response?.message?.content ||
    response?.text ||
    ''
  ).trim();
}

// ── 3. Final fallback ─────────────────────────────────────────────────────
if (!aiReply) {
  aiReply = 'Нет подходящего ответа — требуется проверка менеджера.';
  aiError = true;
  if (!errorMessage) errorMessage = 'Empty or unexpected response from OpenAI';
}

return [{
  json: {
    aiReply,
    aiError,
    errorMessage,
    messageId: email.messageId,
    internetMessageId: email.internetMessageId,
    senderName: email.senderName,
    senderEmail: email.senderEmail,
    subject: email.subject,
    cleanBody: email.cleanBody,
    webLink: email.webLink,
    conversationId: email.conversationId,
    slackThreadTs: $('💬 Post to Slack').first().json.ts
  }
}];
