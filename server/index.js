import { config } from './config.js';
import { fetchMessages, ensureAuth } from './graph.js';
import { postMessage } from './slack.js';
import { normalizeIncoming, normalizeSent } from './normalize.js';
import {
  load, getThread, setThread,
  inboxSeen, sentSeen, markInbox, markSent,
  getState, setLastInboxSync, setLastSentSync,
} from './store.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);

async function processInbox() {
  const since = getState().lastInboxSync;
  const msgs = await fetchMessages('inbox', since);
  // oldest first so threads are created before follow-ups
  msgs.reverse();

  for (const raw of msgs) {
    if (inboxSeen(raw.id)) continue;
    const n = normalizeIncoming(raw);
    if (!n.ok) {
      log('inbox skip:', n.skipReason, '-', raw.subject);
      markInbox(raw.id);
      continue;
    }

    const existing = getThread(n.conversationId);
    if (existing) {
      await postMessage({
        threadTs: existing.threadTs,
        text: `*Email:* ${n.senderEmail}\n\n${n.body}`,
      });
      log('inbox follow-up posted to thread', existing.threadTs);
    } else {
      const ts = await postMessage({
        text: `*Email:* ${n.senderEmail}\n\n${n.body}`,
      });
      setThread(n.conversationId, {
        threadTs: ts,
        channelId: config.slack.channelId,
        senderEmail: n.senderEmail,
        subject: n.subject,
      });
      log('inbox new thread created', ts);
    }
    markInbox(raw.id);
  }
  setLastInboxSync(new Date(Date.now() - 60_000).toISOString());
}

async function processSent() {
  const since = getState().lastSentSync;
  const msgs = await fetchMessages('sentitems', since);
  msgs.reverse();

  for (const raw of msgs) {
    if (sentSeen(raw.id)) continue;
    const n = normalizeSent(raw);
    if (!n.ok) { markSent(raw.id); continue; }

    const mapping = getThread(n.conversationId);
    if (!mapping) { markSent(raw.id); continue; } // no inbound yet — skip

    await postMessage({
      threadTs: mapping.threadTs,
      text: `*Кому:* ${n.toEmails || mapping.senderEmail}\n\n${n.replyText}`,
    });
    log('sent reply mirrored to thread', mapping.threadTs);
    markSent(raw.id);
  }
  setLastSentSync(new Date(Date.now() - 60_000).toISOString());
}

async function tick() {
  try { await processInbox(); } catch (e) { log('inbox error:', e.message); }
  try { await processSent(); }  catch (e) { log('sent error:', e.message); }
}

async function main() {
  load();
  log(`Tooba support bridge starting — mailbox=${config.graph.mailbox} ` +
      `channel=${config.slack.channelId} poll=${config.pollSeconds}s`);
  await ensureAuth();
  await tick();
  setInterval(tick, config.pollSeconds * 1000);
}

main().catch(e => { console.error('fatal:', e); process.exit(1); });
