/**
 * n8n Code node: 📧 Normalize Email
 * Mode: runOnceForAllItems
 *
 * Accepts raw Microsoft Outlook Trigger output and normalises it
 * into a flat, predictable shape for downstream nodes.
 *
 * This file is the source of truth. Copy the contents (excluding
 * this file-level comment) into the n8n Code node's jsCode field.
 */

const email = $input.first().json;

// ── Sender ────────────────────────────────────────────────────────────
// Outlook may expose the sender under email.from or email.sender.
const fromEmail =
  email.from?.emailAddress ||
  email.sender?.emailAddress ||
  {};

const senderName = fromEmail.name || 'Unknown Sender';
const senderEmail = fromEmail.address || null;

// ── Subject ───────────────────────────────────────────────────────────
const subject = email.subject || '(No Subject)';

// ── Body ──────────────────────────────────────────────────────────────
const htmlBody = email.body?.content || '';

function htmlToText(html) {
  if (!html) return '';
  return html
    // Drop style/script blocks entirely
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
    // Preserve line breaks
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n\n')
    .replace(/<\/div>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    // Strip remaining tags
    .replace(/<[^>]+>/g, '')
    // Decode common HTML entities
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    // Collapse excessive blank lines
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

// Prefer HTML body converted to text; fall back to bodyPreview
const cleanBody =
  htmlToText(htmlBody) ||
  email.bodyPreview ||
  '(Empty body)';

// ── IDs and links ─────────────────────────────────────────────────────
const messageId = email.id || null;
const conversationId = email.conversationId || null;
const webLink = email.webLink || null;

// ── Warnings ──────────────────────────────────────────────────────────
const warnings = [];
if (!senderEmail) {
  warnings.push('senderEmail missing from Outlook payload');
}
if (!messageId) {
  warnings.push('messageId missing — Outlook reply draft creation will fail');
}

// ── Output ────────────────────────────────────────────────────────────
return [
  {
    json: {
      messageId,
      conversationId,
      senderName,
      senderEmail: senderEmail || 'UNKNOWN',
      subject,
      cleanBody,
      htmlBody,
      webLink,
      _warnings: warnings.length ? warnings : undefined,
    },
  },
];
