// Tests for normalize.js + store.js. No test framework deps — uses the
// built-in node:test runner. Run with:  npm test   (node --test server/)
//
// Dummy creds are set BEFORE importing config-dependent modules so the tests
// are hermetic and never touch real .env values or live services.
process.env.MS_TENANT_ID  = 'test-tenant';
process.env.MS_CLIENT_ID  = 'test-client';
process.env.MS_MAILBOX    = 'support@tooba.com';
process.env.SLACK_BOT_TOKEN = 'xoxb-test';
process.env.SLACK_CHANNEL_ID = 'C0TEST';
process.env.OWN_DOMAINS   = '@tooba.com,@mx.tooba.com';
process.env.STORE_PATH    = '/tmp/tooba-test-state.json';

import test from 'node:test';
import assert from 'node:assert/strict';
import { rmSync } from 'node:fs';

import { htmlToText, normalizeIncoming, normalizeSent } from './normalize.js';
import {
  load, setThread, getThread, touchThread, findThreadByEmail, pruneThreads,
  inboxSeen, markInbox, getState,
} from './store.js';

const DAY = 86_400_000;

// ---------- htmlToText ----------

test('htmlToText: strips tags, decodes entities, drops link href', () => {
  const out = htmlToText('<p>Цена&nbsp;5&#8470; <a href="http://x.com">тут</a>&amp;всё</p>');
  assert.equal(out, 'Цена 5№ тут&всё');
});

test('htmlToText: preserves literal < > & in plain text', () => {
  assert.equal(htmlToText('5 < 10 & 20 > 1'), '5 < 10 & 20 > 1');
});

test('htmlToText: empty / null -> empty string', () => {
  assert.equal(htmlToText(''), '');
  assert.equal(htmlToText(null), '');
});

// ---------- normalizeIncoming ----------

const htmlEmail = `<!--[if mso]><style>.x{c:red}</style><![endif]-->
<table><tr><td>Здравствуйте,</td></tr><tr><td>вопрос по заказу&nbsp;&#8470;123.</td></tr></table>
<div>Email: client@example.com</div>
<div>________________________________</div>
<div>От: support@tooba.com</div>
<blockquote>старая цитата</blockquote>`;

test('normalizeIncoming: extracts embedded customer email, strips quote, ignores relay', () => {
  const r = normalizeIncoming({
    id: 'm1', conversationId: 'c1', subject: 'Заказ',
    body: { contentType: 'HTML', content: htmlEmail },
    from: { emailAddress: { name: 'Form', address: 'noreply@tooba.com' } },
  });
  assert.equal(r.ok, true);
  assert.equal(r.senderEmail, 'client@example.com');
  assert.match(r.body, /вопрос по заказу №123/);
  assert.doesNotMatch(r.body, /старая цитата/);
  assert.doesNotMatch(r.body, /Email:/);
});

test('normalizeIncoming: replyTo external customer wins over own from', () => {
  const r = normalizeIncoming({
    id: 'm2', conversationId: 'c2', subject: 'Re',
    body: { contentType: 'HTML', content: '<p>Привет, есть вопрос по доставке</p>' },
    from:    { emailAddress: { address: 'support@tooba.com' } },
    replyTo: [{ emailAddress: { address: 'buyer@gmail.com' } }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.senderEmail, 'buyer@gmail.com');
});

test('normalizeIncoming: own support email is skipped', () => {
  const r = normalizeIncoming({
    id: 'm3', conversationId: 'c3', subject: 'x',
    body: { contentType: 'HTML', content: '<p>текст письма достаточной длины</p>' },
    from: { emailAddress: { address: 'support@tooba.com' } },
  });
  assert.equal(r.ok, false);
});

test('normalizeIncoming: too-short body is skipped', () => {
  const r = normalizeIncoming({
    id: 'm4', conversationId: 'c4', subject: 'x',
    body: { contentType: 'HTML', content: '<p>ок</p>' },
    from: { emailAddress: { address: 'buyer@gmail.com' } },
  });
  assert.equal(r.ok, false);
  assert.equal(r.skipReason, 'body too short');
});

test('normalizeIncoming: relay with no recoverable customer is skipped', () => {
  const r = normalizeIncoming({
    id: 'm5', conversationId: 'c5', subject: 'x',
    body: { contentType: 'HTML', content: '<p>сообщение без адреса клиента внутри</p>' },
    from: { emailAddress: { address: 'noreply@tooba.com' } },
  });
  assert.equal(r.ok, false);
});

// ---------- normalizeSent ----------

test('normalizeSent: cleans reply text and lists recipients', () => {
  const r = normalizeSent({
    id: 's1', conversationId: 'c1',
    toRecipients: [{ emailAddress: { address: 'client@example.com' } }],
    body: { contentType: 'HTML', content: '<p>Ваш заказ отправлен.</p><div>От: client@example.com</div><blockquote>старое</blockquote>' },
  });
  assert.equal(r.ok, true);
  assert.equal(r.toEmails, 'client@example.com');
  assert.equal(r.replyText, 'Ваш заказ отправлен.');
});

// ---------- store: dedup migration + grouping + pruning ----------

test('store: migrates legacy array dedup and reports seen ids', () => {
  rmSync('/tmp/tooba-test-state.json', { force: true });
  load();
  markInbox('id-1');
  assert.equal(inboxSeen('id-1'), true);
  assert.equal(inboxSeen('id-x'), false);
});

test('store: findThreadByEmail respects window, touchThread slides it', () => {
  rmSync('/tmp/tooba-test-state.json', { force: true });
  load();
  setThread('cv1', { threadTs: '111.1', channelId: 'C0', senderEmail: 'a@c.com', subject: 'A' });
  setThread('cv2', { threadTs: '222.2', channelId: 'C0', senderEmail: 'b@c.com', subject: 'B' });

  assert.equal(findThreadByEmail('a@c.com', 7 * DAY)?.threadTs, '111.1');
  assert.equal(findThreadByEmail('nobody@c.com', 7 * DAY), null);

  // backdate beyond window -> excluded
  getState().conversationToThread['cv1'].lastActivityAt = new Date(Date.now() - 10 * DAY).toISOString();
  assert.equal(findThreadByEmail('a@c.com', 7 * DAY), null);
  assert.equal(findThreadByEmail('a@c.com', 30 * DAY)?.threadTs, '111.1');

  // touch refreshes -> back in window
  touchThread('cv1');
  assert.equal(findThreadByEmail('a@c.com', 7 * DAY)?.threadTs, '111.1');
});

test('store: pruneThreads drops only inactive mappings', () => {
  rmSync('/tmp/tooba-test-state.json', { force: true });
  load();
  setThread('old', { threadTs: '9.9', channelId: 'C0', senderEmail: 'o@c.com', subject: 'old' });
  setThread('new', { threadTs: '8.8', channelId: 'C0', senderEmail: 'n@c.com', subject: 'new' });
  getState().conversationToThread['old'].lastActivityAt = new Date(Date.now() - 100 * DAY).toISOString();

  const removed = pruneThreads(90 * DAY);
  assert.equal(removed, 1);
  assert.equal(getThread('old'), null);
  assert.ok(getThread('new'));

  rmSync('/tmp/tooba-test-state.json', { force: true });
});
