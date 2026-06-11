import { config } from './config.js';
import { fetchMessages, ensureAuth } from './graph.js';
import { postMessage } from './slack.js';
import { normalizeIncoming, normalizeSent } from './normalize.js';
import {
  load, getThread, findThreadByEmail, pruneThreads, commitInbox, commitSent,
  inboxSeen, sentSeen, markInbox, markSent,
  getState, setLastInboxSync, setLastSentSync,
} from './store.js';

const log = (...a) => console.log(new Date().toISOString(), ...a);
const hoursAgoIso = (h) => new Date(Date.now() - h * 3_600_000).toISOString();

// Cursor is the newest receivedDateTime we have actually seen (clock-independent,
// monotonic). We query with a 60s overlap so boundary/equal-timestamp messages
// aren't missed; dedup drops the re-reads.
const OVERLAP_MS = 60_000;
const sinceFromCursor = (cursor) =>
  cursor ? new Date(Date.parse(cursor) - OVERLAP_MS).toISOString()
         : hoursAgoIso(config.coldStartHours);
const newestReceived = (msgs, cursor) => {
  let newest = Date.parse(cursor || '') || 0;
  for (const raw of msgs) newest = Math.max(newest, Date.parse(raw.receivedDateTime) || 0);
  return newest;
};

async function processInbox() {
  // Cold start (no saved cursor): only look back coldStartHours so the first
  // run doesn't post a backlog of old mail into Slack.
  const cursor = getState().lastInboxSync;
  const msgs = await fetchMessages('inbox', sinceFromCursor(cursor));
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
    let target = getThread(n.conversationId);
    // threadData != null => commit will (re)write the mapping for this
    // conversationId; null => it's an existing mapping, just refresh activity.
    let threadData = null;

    // 2. Fallback: same customer + same topic has a recent thread (a reply that
    //    lost its conversationId). Reuse it and link this conversationId.
    if (!target && config.threadGroupDays > 0) {
      const byEmail = findThreadByEmail(n.senderEmail, config.threadGroupDays * 86_400_000, n.subject);
      if (byEmail) {
        target = byEmail;
        threadData = {
          threadTs: byEmail.threadTs,
          channelId: byEmail.channelId,
          senderEmail: n.senderEmail,
          subject: n.subject,
        };
        log('inbox: linked new conversation to existing thread by email+subject', byEmail.threadTs);
      }
    }

    if (target) {
      await postMessage({
        threadTs: target.threadTs,
        text: `*Клиент написал снова*\n*Email:* ${n.senderEmail}\n*Тема:* ${n.subject}\n\n${n.body}`,
      });
      // Atomic: persist link (if any) + mark processed in one save.
      commitInbox(raw.id, n.conversationId, threadData);
      log('inbox follow-up posted to thread', target.threadTs);
    } else {
      const ts = await postMessage({
        text: `*Новое письмо от клиента*\n*Email:* ${n.senderEmail}\n*Тема:* ${n.subject}\n\n${n.body}`,
      });
      commitInbox(raw.id, n.conversationId, {
        threadTs: ts,
        channelId: config.slack.channelId,
        senderEmail: n.senderEmail,
        subject: n.subject,
      });
      log('inbox new thread created', ts);
    }
  }
  const newest = newestReceived(msgs, cursor);
  if (newest > (Date.parse(cursor || '') || 0)) setLastInboxSync(new Date(newest).toISOString());
}

async function processSent() {
  const cursor = getState().lastSentSync;
  const msgs = await fetchMessages('sentitems', sinceFromCursor(cursor));
  msgs.reverse();

  // Guard against Graph returning duplicate sent items for the same conversation.
  const mirroredThisTick = new Set();

  for (const raw of msgs) {
    if (sentSeen(raw.id)) continue;
    const n = normalizeSent(raw);
    if (!n.ok) { markSent(raw.id); continue; }

    const mapping = getThread(n.conversationId);
    if (!mapping) { markSent(raw.id); continue; } // no inbound yet — skip

    if (mirroredThisTick.has(n.conversationId)) { markSent(raw.id); continue; }

    await postMessage({
      threadTs: mapping.threadTs,
      text: `*Кому:* ${n.toEmails || mapping.senderEmail}\n\n${n.replyText}`,
    });
    mirroredThisTick.add(n.conversationId);
    commitSent(raw.id, n.conversationId); // atomic: touch activity + mark processed
    log('sent reply mirrored to thread', mapping.threadTs);
  }
  const newest = newestReceived(msgs, cursor);
  if (newest > (Date.parse(cursor || '') || 0)) setLastSentSync(new Date(newest).toISOString());
}

// Guard against overlapping runs: setInterval does not wait for the previous
// async tick, and a tick can exceed pollSeconds during retry backoff. Two
// concurrent ticks could double-post to Slack and rotate the MS refresh token
// twice. Skip a tick if the previous one is still running.
let ticking = false;
async function tick() {
  if (ticking) { log('previous tick still running — skipping this interval'); return; }
  ticking = true;
  try {
    try { await processInbox(); } catch (e) { log('inbox error:', e.message); }
    try { await processSent(); }  catch (e) { log('sent error:', e.message); }
    try {
      const removed = pruneThreads(config.threadRetentionDays * 86_400_000);
      if (removed) log(`pruned ${removed} inactive thread mapping(s)`);
    } catch (e) { log('prune error:', e.message); }
  } finally {
    ticking = false;
  }
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
