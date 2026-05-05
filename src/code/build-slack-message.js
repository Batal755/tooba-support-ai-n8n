/**
 * Slack message builder — reference implementation.
 *
 * The actual formatting logic lives inline in the n8n Slack node
 * text fields (as n8n expressions). This file serves as a
 * documented, testable reference.
 *
 * Usage: import and call from unit tests or the import script.
 */

/**
 * Builds the main Slack channel message text for an incoming support email.
 *
 * @param {object} email - Normalised email object from the Normalize Email node.
 * @param {string} email.senderName
 * @param {string} email.senderEmail
 * @param {string} email.subject
 * @param {string} email.cleanBody
 * @param {string|null} email.webLink
 * @returns {string}
 */
export function buildMainMessage({ senderName, senderEmail, subject, cleanBody, webLink }) {
  const divider = '━━━━━━━━━━━━━━━━━━━━';
  const lines = [
    '📩 Новое письмо в support@tooba.com',
    '',
    `От: ${senderName} (${senderEmail})`,
    `Тема: ${subject}`,
    '',
    divider,
    'ТЕКСТ ПИСЬМА:',
    cleanBody,
    '',
    divider,
  ];
  if (webLink) {
    lines.push(`Outlook: ${webLink}`);
  }
  return lines.join('\n');
}

/**
 * Builds the Slack thread reply text containing the AI draft.
 *
 * @param {string} draftReply - AI-generated reply from OpenAI.
 * @param {string} outlookDraftId - Outlook draft message ID.
 * @returns {string}
 */
export function buildThreadReply(draftReply, outlookDraftId) {
  const divider = '━━━━━━━━━━━━━━━━━━━━';
  return [
    '🤖 ЧЕРНОВИК ОТВЕТА:',
    '',
    draftReply,
    '',
    divider,
    '✅ Проверьте черновик в Outlook перед отправкой.',
    `Draft ID: ${outlookDraftId || 'не получен'}`,
  ].join('\n');
}
