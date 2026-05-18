import { config } from './config.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

async function fetchWithRetry(url, opts = {}, attempt = 0) {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000), ...opts });
    if (res.status >= 500 && attempt < 4) {
      await sleep(2 ** attempt * 2000);
      return fetchWithRetry(url, opts, attempt + 1);
    }
    return res;
  } catch (err) {
    if (attempt < 4) {
      const delay = 2 ** attempt * 2000;
      console.error(`[slack] fetch error (attempt ${attempt + 1}/4), retry in ${delay / 1000}s:`, err.message);
      await sleep(delay);
      return fetchWithRetry(url, opts, attempt + 1);
    }
    throw err;
  }
}

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

  const res = await fetchWithRetry('https://slack.com/api/chat.postMessage', {
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
