import { config } from './config.js';
import { fetchMessages, ensureAuth } from './graph.js';
import { postMessage } from './slack.js';
import { normalizeIncoming, normalizeSent } from './normalize.js';
import {
  load, getThread, setThread, touchThread, findThreadByEmail, pruneThreads,
  inboxSeen, sentSeen, markInbox, markSent,
  getState, setLastInboxSync, setLastSentSync,
} from './store.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);
const hoursAgoIso = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

async function processInbox() {
  // Cold start (no saved cursor): only look back coldStartHours so the first
  // run doesn't post a backlog of old mail into Slack.
  const since = getState().lastInboxSync || hoursAgoIso(config.coldStartHours);
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

    // 1. Direct match: this conversationId already has a thread.
    let mapping = getThread(n.conversationId);

    // 2. Fallback: no thread for this conversationId, but the same customer
    //    has a recent thread (they started a new subject). Reuse it and link
    //    this conversationId so future messages map directly.
    if (!mapping && config.threadGroupDays > 0) {
      const byEmail = findThreadByEmail(n.senderEmail, config.threadGroupDays * 86_400_000);
      if (byEmail) {
        setThread(n.conversationId, {
          threadTs: byEmail.threadTs,
          channelId: byEmail.channelId,
          senderEmail: n.senderEmail,
          subject: n.subject,
        });
        mapping = getThread(n.conversationId);
        log('inbox: linked new conversation to existing thread by email', byEmail.threadTs);
      }
    }

    if (mapping) {
      await postMessage({
        threadTs: mapping.threadTs,
        text: `*Клиент написал снова*\n*Email:* ${n.senderEmail}\n*Тема:* ${n.subject}\n\n${n.body}`,
      });
      touchThread(n.conversationId);
      log('inbox follow-up posted to thread', mapping.threadTs);
    } else {
      const ts = await postMessage({
        text: `*Новое письмо от клиента*\n*Email:* ${n.senderEmail}\n*Тема:* ${n.subject}\n\n${n.body}`,
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
  const since = getState().lastSentSync || hoursAgoIso(config.coldStartHours);
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
      text: `*Менеджер ответил клиенту*\n*Кому:* ${n.toEmails || mapping.senderEmail}\n\n${n.replyText}`,
    });
    touchThread(n.conversationId);
    log('sent reply mirrored to thread', mapping.threadTs);
    markSent(raw.id);
  }
  setLastSentSync(new Date(Date.now() - 60_000).toISOString());
}

async function tick() {
  try { await processInbox(); } catch (e) { log('inbox error:', e.message); }
  try { await processSent(); }  catch (e) { log('sent error:', e.message); }
  try {
    const removed = pruneThreads(config.threadRetentionDays * 86_400_000);
    if (removed) log(`pruned ${removed} inactive thread mapping(s)`);
  } catch (e) { log('prune error:', e.message); }
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
