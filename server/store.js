import { readFileSync, writeFileSync, existsSync, renameSync, chmodSync } from 'node:fs';
import { config } from './config.js';

// Atomic JSON file store. Holds the conversation→Slack-thread mapping
// plus dedup sets for processed inbox/sent message ids.
const DEFAULT = {
  conversationToThread: {}, // conversationId -> { threadTs, channelId, senderEmail, subject, storedAt }
  processedInbox: {},       // message id -> processedAt(ms)  (dedup, time-pruned)
  processedSent: {},        // sent message id -> processedAt(ms)
  lastInboxSync: null,      // ISO timestamp
  lastSentSync: null,
  msRefreshToken: null,     // delegated auth refresh token
};

let state = structuredClone(DEFAULT);

// Old versions stored dedup as a flat array of ids capped at 1000. Convert any
// such array into the id->timestamp map so upgrades don't lose dedup state.
function migrateDedup(v) {
  if (Array.isArray(v)) {
    const now = Date.now();
    return Object.fromEntries(v.map(id => [id, now]));
  }
  return v && typeof v === 'object' ? v : {};
}

export function load() {
  if (existsSync(config.storePath)) {
    try {
      state = { ...structuredClone(DEFAULT), ...JSON.parse(readFileSync(config.storePath, 'utf8')) };
      state.processedInbox = migrateDedup(state.processedInbox);
      state.processedSent  = migrateDedup(state.processedSent);
    } catch (e) {
      console.error('[store] corrupt state file, starting fresh:', e.message);
    }
  }
  return state;
}

export function save() {
  const tmp = config.storePath + '.tmp';
  // 0600: state.json holds the Microsoft refresh token in plain text, so it
  // must be readable only by the owner. mode on the temp file is preserved
  // across rename; chmod the final path too in case it pre-existed with looser
  // permissions.
  writeFileSync(tmp, JSON.stringify(state, null, 2), { mode: 0o600 });
  renameSync(tmp, config.storePath);
  try { chmodSync(config.storePath, 0o600); } catch { /* best effort (e.g. non-POSIX FS) */ }
}

export function getThread(conversationId) {
  return state.conversationToThread[conversationId] || null;
}

export function setThread(conversationId, data) {
  const now = new Date().toISOString();
  state.conversationToThread[conversationId] = { ...data, storedAt: now, lastActivityAt: now };
  save();
}

// Bump the activity timestamp so the email-grouping window slides forward
// each time a conversation sees new traffic.
export function touchThread(conversationId) {
  const t = state.conversationToThread[conversationId];
  if (t) { t.lastActivityAt = new Date().toISOString(); save(); }
}

// Normalise a subject for topic comparison: drop any chain of reply/forward
// prefixes (Re:, Fwd:, Fw:, Ответ:, Пересл:) and collapse whitespace/case.
export function normSubject(s) {
  return String(s || '')
    .replace(/^(\s*(re|fwd?|fw|ответ|пересл)\s*:\s*)+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

// Find the most recently active thread for a customer email, used as a fallback
// when a new email has a conversationId we have never seen. To avoid merging
// unrelated topics, a `subject` (when given) must match the thread's subject
// after stripping Re:/Fwd: prefixes — so a reply that lost its conversationId
// regroups, but a genuinely new question opens its own thread.
export function findThreadByEmail(email, withinMs, subject) {
  if (!email) return null;
  const target = email.toLowerCase();
  const subj = subject != null ? normSubject(subject) : null;
  const cutoff = withinMs ? Date.now() - withinMs : 0;
  let best = null;
  for (const t of Object.values(state.conversationToThread)) {
    if ((t.senderEmail || '').toLowerCase() !== target) continue;
    if (subj !== null && normSubject(t.subject) !== subj) continue;
    const ts = Date.parse(t.lastActivityAt || t.storedAt || '') || 0;
    if (ts < cutoff) continue;
    if (!best || ts > (Date.parse(best.lastActivityAt || best.storedAt || '') || 0)) best = t;
  }
  return best;
}

// Record an id as processed and prune entries older than the dedup retention
// horizon. Time-based (not a fixed count cap), so a burst of >1000 messages in
// one tick can never evict an id that could still be re-fetched.
function markDedup(map, id) {
  const now = Date.now();
  map[id] = now;
  const cutoff = now - config.dedupRetentionHours * 3_600_000;
  for (const k in map) if (map[k] < cutoff) delete map[k];
}

export const inboxSeen  = (id) => id in state.processedInbox;
export const sentSeen   = (id) => id in state.processedSent;
export const markInbox  = (id) => { markDedup(state.processedInbox, id); save(); };
export const markSent   = (id) => { markDedup(state.processedSent, id); save(); };

// Atomic post-commit: record the thread mapping (or refresh activity) AND mark
// the source message processed in ONE save(). This removes the multi-write
// window where a crash could persist a thread mapping but leave its message
// unmarked — which on restart would re-post it as a duplicate. Residual: a
// crash between Slack accepting the post and this single save still re-posts on
// restart (true exactly-once needs a Slack-side idempotency key); we keep
// at-least-once so a customer message is never lost.
export function commitInbox(messageId, conversationId, threadData) {
  if (threadData) {
    const now = new Date().toISOString();
    state.conversationToThread[conversationId] = { ...threadData, storedAt: now, lastActivityAt: now };
  } else {
    const t = state.conversationToThread[conversationId];
    if (t) t.lastActivityAt = new Date().toISOString();
  }
  markDedup(state.processedInbox, messageId);
  save();
}

export function commitSent(messageId, conversationId) {
  const t = state.conversationToThread[conversationId];
  if (t) t.lastActivityAt = new Date().toISOString();
  markDedup(state.processedSent, messageId);
  save();
}

// Drop conversation→thread mappings inactive for longer than retentionMs.
// Keeps state.json bounded over time. Returns how many were removed.
export function pruneThreads(retentionMs) {
  const cutoff = Date.now() - retentionMs;
  let removed = 0;
  for (const [cid, t] of Object.entries(state.conversationToThread)) {
    const ts = Date.parse(t.lastActivityAt || t.storedAt || '') || 0;
    if (ts && ts < cutoff) { delete state.conversationToThread[cid]; removed++; }
  }
  if (removed) save();
  return removed;
}

export function getState() { return state; }
export function setLastInboxSync(ts) { state.lastInboxSync = ts; save(); }
export function setLastSentSync(ts)  { state.lastSentSync  = ts; save(); }

export const getRefreshToken = () => state.msRefreshToken;
export function setRefreshToken(t) { state.msRefreshToken = t; save(); }
