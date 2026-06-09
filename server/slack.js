import { config } from './config.js';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// See graph.js for the rationale: 5xx/429 retry for any method (429 honours
// Retry-After), but network-error retry only for idempotent methods so a
// posted Slack message isn't duplicated when the response is lost.
async function fetchWithRetry(url, opts = {}, attempt = 0) {
  const idempotent = !opts.method || ['GET', 'HEAD'].includes(opts.method.toUpperCase());
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(30_000), ...opts });
    if ((res.status >= 500 || res.status === 429) && attempt < 4) {
      const retryAfter = Number(res.headers.get('retry-after'));
      const delay = retryAfter > 0 ? retryAfter * 1000 : 2 ** attempt * 2000;
      await sleep(delay);
      return fetchWithRetry(url, opts, attempt + 1);
    }
    return res;
  } catch (err) {
    if (idempotent && attempt < 4) {
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
