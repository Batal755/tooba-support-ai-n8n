import { config } from './config.js';

// Microsoft Graph client — application (client-credentials) auth.
// Requires Azure app with Mail.Read + Mail.Send application permissions
// granted admin consent for the tenant.

let cachedToken = null;
let tokenExpiry = 0;

async function getToken() {
  if (cachedToken && Date.now() < tokenExpiry - 60_000) return cachedToken;

  const url = `https://login.microsoftonline.com/${config.graph.tenantId}/oauth2/v2.0/token`;
  const body = new URLSearchParams({
    client_id: config.graph.clientId,
    client_secret: config.graph.clientSecret,
    scope: 'https://graph.microsoft.com/.default',
    grant_type: 'client_credentials',
  });

  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`Graph token failed ${res.status}: ${await res.text()}`);
  }
  const json = await res.json();
  cachedToken = json.access_token;
  tokenExpiry = Date.now() + json.expires_in * 1000;
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

// Fetch recent messages from a well-known folder ('inbox' | 'sentitems').
export async function fetchMessages(folder, sinceIso, top = 25) {
  const mb = encodeURIComponent(config.graph.mailbox);
  let path =
    `/users/${mb}/mailFolders/${folder}/messages` +
    `?$select=${FIELDS}&$top=${top}&$orderby=receivedDateTime desc`;
  if (sinceIso) {
    path += `&$filter=receivedDateTime ge ${encodeURIComponent(sinceIso)}`;
  }
  const json = await graphGet(path);
  return json.value || [];
}

// Send a reply email in an existing conversation thread.
export async function sendMail({ to, subject, html }) {
  const token = await getToken();
  const mb = encodeURIComponent(config.graph.mailbox);
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${mb}/sendMail`, {
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
