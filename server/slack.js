import { config } from './config.js';

// Post a message to Slack. If threadTs is given, the message is posted
// as a threaded reply. Returns the message ts (used as the thread root).
export async function postMessage({ text, threadTs }) {
  const payload = {
    channel: config.slack.channelId,
    text,
    unfurl_links: false,
    unfurl_media: false,
    // Custom username + icon makes Slack render each message with its
    // own header instead of grouping consecutive bot messages.
    username: config.slack.username,
  };
  if (threadTs) payload.thread_ts = threadTs;

  const res = await fetch('https://slack.com/api/chat.postMessage', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.slack.token}`,
      'Content-Type': 'application/json; charset=utf-8',
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!json.ok) throw new Error(`Slack postMessage failed: ${json.error}`);
  return json.ts;
}
