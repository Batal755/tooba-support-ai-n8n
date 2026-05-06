// Robust email normalizer v2 — handles multiple Outlook/Graph JSON shapes.
// Outputs: messageId, internetMessageId, senderName, senderEmail, subject,
//          receivedDateTime, rawBodyHtml, cleanBody, skip, skipReason.

const item = $input.first().json;

// ── 1. IDs ────────────────────────────────────────────────────────────────
const messageId = item.id || item.messageId || null;
const internetMessageId = item.internetMessageId || null;

// ── 2. Sender ─────────────────────────────────────────────────────────────
const fromObj =
  item.from?.emailAddress ||
  item.sender?.emailAddress ||
  item.from ||
  {};

let senderEmail = (
  fromObj.address || fromObj.email || fromObj.emailAddress || ''
).toLowerCase().trim();

let senderName = (
  fromObj.name || fromObj.displayName || senderEmail || 'Unknown Sender'
).trim();

if (!senderName) senderName = senderEmail || 'Unknown Sender';

// ── 3. Subject, received date ─────────────────────────────────────────────
const subject = (item.subject || '(No Subject)').trim();
const receivedDateTime = item.receivedDateTime || item.createdDateTime || '';

// ── 4. Body ───────────────────────────────────────────────────────────────
const rawBodyHtml = item.body?.content || '';

function htmlToText(html) {
  if (!html) return '';
  return html
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/tr>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

const cleanBody = htmlToText(rawBodyHtml) || item.bodyPreview || '';

// ── 5. Skip logic ─────────────────────────────────────────────────────────
let skip = false;
let skipReason = '';
const subjLow = subject.toLowerCase();

if (!messageId) {
  skip = true; skipReason = 'messageId missing';
}
if (!skip && item.isDraft === true) {
  skip = true; skipReason = 'item is a draft';
}
if (!skip && senderEmail.includes('support@tooba.com')) {
  skip = true; skipReason = 'sender is support@tooba.com — own email';
}
if (!skip && (subjLow.startsWith('re:') || subjLow.startsWith('ответить:')) && senderEmail.includes('support@tooba.com')) {
  skip = true; skipReason = 're:/ответить: from support@tooba.com';
}
if (!skip && cleanBody.length < 3) {
  skip = true; skipReason = 'cleanBody < 3 chars';
}

// Dedup — keep last 500 processed message IDs in workflow static data
if (!skip && messageId) {
  const sd = $getWorkflowStaticData('global');
  if (!Array.isArray(sd.processedIds)) sd.processedIds = [];
  if (sd.processedIds.includes(messageId)) {
    skip = true; skipReason = 'duplicate — messageId already processed';
  } else {
    sd.processedIds.push(messageId);
    if (sd.processedIds.length > 500) sd.processedIds = sd.processedIds.slice(-500);
  }
}

// ── 6. Output ─────────────────────────────────────────────────────────────
return [{
  json: {
    messageId,
    internetMessageId,
    senderName,
    senderEmail: senderEmail || 'UNKNOWN',
    subject,
    receivedDateTime,
    rawBodyHtml,
    cleanBody,
    webLink: item.webLink || null,
    conversationId: item.conversationId || null,
    skip,
    skipReason
  }
}];
