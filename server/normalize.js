import { config } from './config.js';
import { convert } from 'html-to-text';

const isOwn = (email) =>
  config.ownDomains.some(d => email.includes(d));

function addr(obj) {
  const o = obj?.emailAddress || obj || {};
  return {
    name: String(o.name || o.displayName || '').trim(),
    address: String(o.address || o.email || '').toLowerCase().trim(),
  };
}

// HTML → plain text via the `html-to-text` library: it parses a real DOM tree
// (not regex), so it survives Outlook's table-based layout, nested tags,
// conditional [if mso] comments and HTML entities far more reliably.
// Links render as their visible text (href dropped), images are skipped,
// tables are flattened row-by-row. Plain-text bodies pass through unchanged.
const HTML_TO_TEXT_OPTS = {
  wordwrap: false, // keep original line breaks — email-extraction regexes are line-based
  selectors: [
    { selector: 'a', options: { ignoreHref: true } },
    { selector: 'img', format: 'skip' },
    { selector: 'table', format: 'dataTable' },
  ],
};

export function htmlToText(raw) {
  if (!raw) return '';
  return convert(String(raw), HTML_TO_TEXT_OPTS)
    .replace(/\r/g, '')
    .replace(/\u00A0/g, " ") // &nbsp; -> normal space (line-based regexes expect it)
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function stripQuotes(text) {
  if (!text) return '';
  const cuts = [
    /\n-{2,}\s*Original Message\s*-{2,}/i,
    /\nОт:\s/i,
    /\nFrom:\s/i,
    /\nOn .+wrote:/i,
    /\n.*написал\(а\):/i,
    /\n_{10,}/,
  ];
  let cut = -1;
  for (const rx of cuts) {
    const m = rx.exec(text);
    if (m && (cut === -1 || m.index < cut)) cut = m.index;
  }
  return cut >= 0 ? text.slice(0, cut).trim() : text.trim();
}

// Parse a raw Graph inbox message into a normalized record.
// Returns { ok, skipReason, ... } — ok=false means do not post.
export function normalizeIncoming(item) {
  const messageId = item.id || null;
  const conversationId = item.conversationId || null;
  const subject = String(item.subject || '').trim();

  if (!messageId) return { ok: false, skipReason: 'messageId missing' };
  if (!conversationId) return { ok: false, skipReason: 'conversationId missing' };
  if (item.isDraft) return { ok: false, skipReason: 'draft ignored' };

  const raw = item.body?.content || item.bodyPreview || '';
  let body = stripQuotes(htmlToText(raw));

  const explicitEmail = (body.match(/Email\s*[:：]\s*([^\s<>]+@[^\s<>]+)/i) || [])[1]?.toLowerCase().trim() || '';
  const embeddedEmail = (body.match(/Отправлено от\s+([^\s<>]+@[^\s<>]+)/i) || [])[1]?.toLowerCase().trim() || '';
  const bodyEmail = (body.match(/\b[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}\b/g) || [])
    .map(e => e.toLowerCase())
    .find(e => !isOwn(e)) || '';

  body = body
    .replace(/\n?\s*Отправлено от\s+[^\s<>]+@[^\s<>]+/gi, '')
    .replace(/^\s*(ID\s*(обращения)?\s*[:：]\s*\d+)\s*$/gim, '')
    .replace(/^\s*Email\s*[:：]\s*[^\s<>]+@[^\s<>]+\s*$/gim, '')
    .replace(/^\s*Сообщение\s*[:：]\s*/gim, '')
    .replace(/Получите Outlook для .+$/gim, '')
    .replace(/Outlook:\s*https?:\/\/\S+/gi, '')
    .trim();

  const from = addr(item.from);
  const sender = addr(item.sender);
  const replyTo = Array.isArray(item.replyTo) && item.replyTo.length ? addr(item.replyTo[0]) : { name: '', address: '' };
  const ccExt = (Array.isArray(item.ccRecipients) ? item.ccRecipients : [])
    .map(addr).find(e => e.address && !isOwn(e.address));

  const customer =
      (replyTo.address && !isOwn(replyTo.address)) ? replyTo
    : ccExt?.address                               ? ccExt
    : explicitEmail                                ? { name: explicitEmail, address: explicitEmail }
    : embeddedEmail                                ? { name: embeddedEmail, address: embeddedEmail }
    : (from.address && !isOwn(from.address))        ? from
    : (sender.address && !isOwn(sender.address))    ? sender
    : bodyEmail                                     ? { name: bodyEmail, address: bodyEmail }
    : from;

  const senderEmail = customer.address || '';
  const senderName = (customer.name && customer.name.toLowerCase() !== senderEmail) ? customer.name : senderEmail;

  if (!senderEmail) return { ok: false, skipReason: 'senderEmail not found' };
  if (senderEmail.includes('support@tooba.com')) return { ok: false, skipReason: 'own support email' };
  if (isOwn(senderEmail) && !explicitEmail && !embeddedEmail && !bodyEmail)
    return { ok: false, skipReason: 'relay no-reply, customer not found' };
  if (!body || body.length < 3) return { ok: false, skipReason: 'body too short' };

  return { ok: true, messageId, conversationId, subject, body, senderEmail, senderName };
}

// Parse a sent message (manager's reply) for mirroring into the Slack thread.
export function normalizeSent(item) {
  const messageId = item.id || null;
  const conversationId = item.conversationId || null;
  if (!messageId || !conversationId || item.isDraft) return { ok: false };

  const toEmails = (Array.isArray(item.toRecipients) ? item.toRecipients : [])
    .map(addr).filter(e => e.address).map(e => e.address).join(', ');

  let replyText = stripQuotes(htmlToText(item.body?.content || item.bodyPreview || ''));
  replyText = replyText.replace(/^\s*Получите Outlook для .+$/gim, '').trim();
  if (!replyText || replyText.length < 2) return { ok: false };

  return { ok: true, messageId, conversationId, toEmails, replyText };
}
