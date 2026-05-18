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
  state.conversationToThread[conversationId] = { ...data, storedAt: new Date().toISOString() };
  save();
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
