import { readFileSync, writeFileSync, existsSync, renameSync } from 'node:fs';
import { config } from './config.js';

// Atomic JSON file store. Holds the conversation→Slack-thread mapping
// plus dedup sets for processed inbox/sent message ids.
const DEFAULT = {
  conversationToThread: {}, // conversationId -> { threadTs, channelId, senderEmail, subject, storedAt }
  processedInbox: [],       // message ids already posted (dedup)
  processedSent: [],        // sent message ids already mirrored (dedup)
  lastInboxSync: null,      // ISO timestamp
  lastSentSync: null,
  msRefreshToken: null,     // delegated auth refresh token
};

let state = structuredClone(DEFAULT);

export function load() {
  if (existsSync(config.storePath)) {
    try {
      state = { ...structuredClone(DEFAULT), ...JSON.parse(readFileSync(config.storePath, 'utf8')) };
    } catch (e) {
      console.error('[store] corrupt state file, starting fresh:', e.message);
    }
  }
  return state;
}

export function save() {
  const tmp = config.storePath + '.tmp';
  writeFileSync(tmp, JSON.stringify(state, null, 2));
  renameSync(tmp, config.storePath);
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

// Find the most recently active thread for a customer email, optionally
// limited to threads active within `withinMs`. Used as a fallback when a
// new email has a conversationId we have never seen (e.g. the customer
// started a fresh subject instead of replying).
export function findThreadByEmail(email, withinMs) {
  if (!email) return null;
  const target = email.toLowerCase();
  const cutoff = withinMs ? Date.now() - withinMs : 0;
  let best = null;
  for (const t of Object.values(state.conversationToThread)) {
    if ((t.senderEmail || '').toLowerCase() !== target) continue;
    const ts = Date.parse(t.lastActivityAt || t.storedAt || '') || 0;
    if (ts < cutoff) continue;
    if (!best || ts > (Date.parse(best.lastActivityAt || best.storedAt || '') || 0)) best = t;
  }
  return best;
}

function markRing(arr, id, max = 1000) {
  arr.push(id);
  if (arr.length > max) arr.splice(0, arr.length - max);
}

export const inboxSeen  = (id) => state.processedInbox.includes(id);
export const sentSeen   = (id) => state.processedSent.includes(id);
export const markInbox  = (id) => { markRing(state.processedInbox, id); save(); };
export const markSent   = (id) => { markRing(state.processedSent, id); save(); };

export function getState() { return state; }
export function setLastInboxSync(ts) { state.lastInboxSync = ts; save(); }
export function setLastSentSync(ts)  { state.lastSentSync  = ts; save(); }

export const getRefreshToken = () => state.msRefreshToken;
export function setRefreshToken(t) { state.msRefreshToken = t; save(); }
