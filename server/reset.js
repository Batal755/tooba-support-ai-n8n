import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { config } from './config.js';

// Clean restart: wipes thread mappings, dedup sets and sync cursors so
// every email is re-posted as a fresh Slack thread. Preserves the
// Microsoft refresh token so no browser re-login is needed.

if (!existsSync(config.storePath)) {
  console.error('No state file at', config.storePath, '- nothing to reset.');
  process.exit(1);
}

const prev = JSON.parse(readFileSync(config.storePath, 'utf8'));

const fresh = {
  conversationToThread: {},
  processedInbox: [],
  processedSent: [],
  lastInboxSync: null,
  lastSentSync: null,
  msRefreshToken: prev.msRefreshToken || null,
};

writeFileSync(config.storePath, JSON.stringify(fresh, null, 2));

console.log('State reset. Threads/dedup cleared, refresh token preserved.');
console.log(prev.msRefreshToken
  ? 'Refresh token kept — no re-login needed.'
  : 'WARNING: no refresh token found — device-code login will be required.');
