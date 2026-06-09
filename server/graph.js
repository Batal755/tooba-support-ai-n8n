import { config } from './config.js';
import { getRefreshToken, setRefreshToken } from './store.js';

// Microsoft Graph — DELEGATED auth via device-code flow.
// Uses the already-granted delegated permissions (Mail.Read, Mail.Send,
// offline_access). No tenant admin consent required. On first run the
// operator signs in once in a browser; the refresh token is persisted.

const SCOPE = 'offline_access Mail.Read Mail.Send User.Read';
const authBase = `https://login.microsoftonline.com/${config.graph.tenantId}/oauth2/v2.0`;

let cachedToken = null;
let tokenExpiry = 0;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Retry fetch up to 4 times with exponential backoff (2s, 4s, 8s, 16s).
// - 5xx and 429 are safe to retry for any method (the server did not process
//   the request); 429 honours the Retry-After header.
// - On a network error we only retry idempotent methods (GET/HEAD). A POST may
//   have already been processed server-side before the connection dropped, so
//   retrying it could duplicate the side effect (e.g. a sent mail).
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
      console.error(`[graph] fetch error (attempt ${attempt + 1}/4), retry in ${delay / 1000}s:`, err.message);
      await sleep(delay);
      return fetchWithRetry(url, opts, attempt + 1);
    }
    throw err;
  }
}

async function deviceCodeLogin() {
  const res = await fetchWithRetry(`${authBase}/devicecode`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.graph.clientId, scope: SCOPE }),
  });
  if (!res.ok) throw new Error(`devicecode failed ${res.status}: ${await res.text()}`);
  const dc = await res.json();

  console.log('\n========================================================');
  console.log(' ВОЙДИ ОДИН РАЗ ЧТОБЫ АВТОРИЗОВАТЬ СЕРВЕР:');
  console.log(`   1. Открой: ${dc.verification_uri}`);
  console.log(`   2. Введи код: ${dc.user_code}`);
  console.log('   3. Войди под support@tooba.com');
  console.log('========================================================\n');

  const deadline = Date.now() + dc.expires_in * 1000;
  let interval = (dc.interval || 5) * 1000;

  while (Date.now() < deadline) {
    await sleep(interval);
    const t = await fetchWithRetry(`${authBase}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code',
        client_id: config.graph.clientId,
        device_code: dc.device_code,
      }),
    });
    const j = await t.json();
    if (t.ok) {
      setRefreshToken(j.refresh_token);
      cachedToken = j.access_token;
      tokenExpiry = Date.now() + j.expires_in * 1000;
      console.log('[auth] device-code login OK — refresh token saved\n');
      return;
    }
    if (j.error === 'authorization_pending') continue;
    if (j.error === 'slow_down') { interval += 5000; continue; }
    throw new Error(`device-code auth failed: ${j.error} ${j.error_description || ''}`);
  }
  throw new Error('device-code login timed out — restart and try again');
}

async function refresh() {
  const rt = getRefreshToken();
  if (!rt) return false;
  const res = await fetchWithRetry(`${authBase}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: config.graph.clientId,
      refresh_token: rt,
      scope: SCOPE,
    }),
  });
  if (!res.ok) {
    console.error('[auth] refresh failed, re-login required:', await res.text());
    return false;
  }
  const j = await res.json();
  if (j.refresh_token) setRefreshToken(j.refresh_token);
  cachedToken = j.access_token;
  tokenExpiry = Date.now() + j.expires_in * 1000;
  return true;
}

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) return cachedToken;
  if (await refresh()) return cachedToken;
  await deviceCodeLogin();
  return cachedToken;
}

// GET an absolute Graph URL (used for both the first page and @odata.nextLink,
// which Graph returns as a fully-qualified URL).
async function graphGetUrl(url) {
  const token = await getToken();
  const res = await fetchWithRetry(url, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Graph GET ${url} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

const FIELDS =
  'id,conversationId,subject,bodyPreview,body,from,sender,replyTo,' +
  'toRecipients,ccRecipients,isDraft,receivedDateTime,sentDateTime';

// Delegated: operate on the signed-in mailbox via /me. Follows @odata.nextLink
// so a busy window isn't truncated at one page. maxPages is a safety cap
// (pageSize*maxPages messages) so a wide window can't trigger a runaway crawl.
export async function fetchMessages(folder, sinceIso, { pageSize = 50, maxPages = 20 } = {}) {
  let path =
    `/me/mailFolders/${folder}/messages` +
    `?$select=${FIELDS}&$top=${pageSize}&$orderby=receivedDateTime desc`;
  if (sinceIso) path += `&$filter=receivedDateTime ge ${encodeURIComponent(sinceIso)}`;

  const out = [];
  let url = `https://graph.microsoft.com/v1.0${path}`;
  for (let page = 0; page < maxPages && url; page++) {
    const json = await graphGetUrl(url);
    out.push(...(json.value || []));
    url = json['@odata.nextLink'] || null;
  }
  if (url) console.error(`[graph] ${folder}: hit maxPages=${maxPages}, more messages may remain`);
  return out;
}

export async function sendMail({ to, subject, html }) {
  const token = await getToken();
  const res = await fetchWithRetry('https://graph.microsoft.com/v1.0/me/sendMail', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: {
        subject,
        body: { contentType: 'HTML', content: html },
        toRecipients: to.map(a => ({ emailAddress: { address: a } })),
      },
      saveToSentItems: true,
    }),
  });
  if (!res.ok) throw new Error(`Graph sendMail -> ${res.status}: ${await res.text()}`);
}

// Ensure we have a usable token at startup (triggers device-code login if needed).
export async function ensureAuth() { await getToken(); }
