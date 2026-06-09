import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));

// Minimal .env loader (no dependency). Looks for server/.env then repo .env.local
function loadEnvFile() {
  for (const p of [join(here, '.env'), join(here, '..', '.env.local')]) {
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, 'utf8').split('\n')) {
      const t = line.trim();
      if (!t || t.startsWith('#')) continue;
      const eq = t.indexOf('=');
      if (eq === -1) continue;
      const k = t.slice(0, eq).trim();
      let v = t.slice(eq + 1).trim();
      if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) {
        v = v.slice(1, -1);
      }
      if (!(k in process.env)) process.env[k] = v;
    }
  }
}
loadEnvFile();

function req(name) {
  const v = process.env[name];
  if (!v) {
    console.error(`[config] Missing required env var: ${name}`);
    process.exit(1);
  }
  return v;
}

export const config = {
  // Microsoft Graph (Azure app registration, application permissions)
  graph: {
    tenantId:     req('MS_TENANT_ID'),
    clientId:     req('MS_CLIENT_ID'),
    mailbox:      req('MS_MAILBOX'), // signed-in mailbox, e.g. support@tooba.com
  },
  slack: {
    token:      req('SLACK_BOT_TOKEN'),   // xoxb-...
    channelId:  req('SLACK_CHANNEL_ID'),  // C0ATU9ZD2UF
    username:   process.env.SLACK_USERNAME || 'Tooba Support',
    iconEmoji:  process.env.SLACK_ICON_EMOJI || ':envelope_with_arrow:',
  },
  ownDomains: (process.env.OWN_DOMAINS || '@tooba.com,@mx.tooba.com')
    .split(',').map(s => s.trim().toLowerCase()).filter(Boolean),
  pollSeconds: Number(process.env.POLL_SECONDS || 30),
  // Group emails from the same customer into one Slack thread when they arrive
  // within this many days of the last activity, even if Outlook gave them a
  // new conversationId (new subject). 0 disables grouping (one thread per
  // conversationId — the original behaviour).
  threadGroupDays: Number(process.env.THREAD_GROUP_DAYS ?? 7),
  // Cold start: on the very first run (no saved cursor) only look back this
  // many hours, so we don't dump old mail into Slack.
  coldStartHours: Number(process.env.COLD_START_HOURS ?? 1),
  // How long to remember processed message ids for dedup. Only needs to exceed
  // the fetch overlap window; 24h is a very safe default.
  dedupRetentionHours: Number(process.env.DEDUP_RETENTION_HOURS ?? 24),
  // Drop conversation→thread mappings with no activity for this many days,
  // keeping state.json bounded. Should exceed threadGroupDays.
  threadRetentionDays: Number(process.env.THREAD_RETENTION_DAYS ?? 90),
  storePath:   process.env.STORE_PATH || join(here, 'state.json'),
};
