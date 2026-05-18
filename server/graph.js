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

async function deviceCodeLogin() {
  const res = await fetch(`${authBase}/devicecode`, {
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
    const t = await fetch(`${authBase}/token`, {
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
  const res = await fetch(`${authBase}/token`, {
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

async function graphGet(path) {
  const token = await getToken();
  const res = await fetch(`https://graph.microsoft.com/v1.0${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`Graph GET ${path} -> ${res.status}: ${await res.text()}`);
  return res.json();
}

const FIELDS =
  'id,conversationId,subject,bodyPreview,body,from,sender,replyTo,' +
  'toRecipients,ccRecipients,isDraft,receivedDateTime,sentDateTime';

// Delegated: operate on the signed-in mailbox via /me.
export async function fetchMessages(folder, sinceIso, top = 25) {
  let path =
    `/me/mailFolders/${folder}/messages` +
    `?$select=${FIELDS}&$top=${top}&$orderby=receivedDateTime desc`;
  if (sinceIso) path += `&$filter=receivedDateTime ge ${encodeURIComponent(sinceIso)}`;
  const json = await graphGet(path);
  return json.value || [];
}

export async function sendMail({ to, subject, html }) {
  const token = await getToken();
  const res = await fetch('https://graph.microsoft.com/v1.0/me/sendMail', {
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
