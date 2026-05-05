#!/usr/bin/env node
/**
 * import-to-n8n.mjs
 *
 * Run: npm run import:n8n
 *
 * Reads .env.local, validates the workflow JSON, then attempts to
 * import it into a self-hosted n8n instance via the n8n Public API.
 *
 * Required environment variables (in .env.local):
 *   N8N_BASE_URL  — e.g. http://localhost:5678
 *   N8N_API_KEY   — Settings → API → Create API key
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');

// ── Load .env.local ────────────────────────────────────────────────────
const ENV_PATH = join(ROOT, '.env.local');
if (!existsSync(ENV_PATH)) {
  console.error('❌  .env.local not found.');
  console.error('   Copy .env.example → .env.local and fill in real values.');
  process.exit(1);
}

function parseEnvFile(path) {
  const env = {};
  const lines = readFileSync(path, 'utf8').split('\n');
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const idx = trimmed.indexOf('=');
    if (idx === -1) continue;
    const key = trimmed.slice(0, idx).trim();
    const val = trimmed.slice(idx + 1).trim().replace(/^['"]|['"]$/g, '');
    env[key] = val;
  }
  return env;
}

const env = parseEnvFile(ENV_PATH);

const N8N_BASE_URL = (env.N8N_BASE_URL || '').replace(/\/$/, '');
const N8N_API_KEY  = env.N8N_API_KEY || '';

if (!N8N_BASE_URL) {
  console.error('❌  N8N_BASE_URL is not set in .env.local');
  process.exit(1);
}
if (!N8N_API_KEY) {
  console.error('❌  N8N_API_KEY is not set in .env.local');
  process.exit(1);
}

// ── Load & validate workflow JSON ──────────────────────────────────────
const WORKFLOW_PATH = join(ROOT, 'workflows', 'tooba-support-ai-n8n.workflow.json');

let workflowJson;
try {
  const raw = readFileSync(WORKFLOW_PATH, 'utf8');
  workflowJson = JSON.parse(raw);
  console.log(`📋 Workflow loaded: "${workflowJson.name}"`);
} catch (err) {
  console.error(`❌  Failed to read or parse workflow JSON: ${err.message}`);
  process.exit(1);
}

// ── Attempt n8n Public API import ─────────────────────────────────────
//
// n8n Public API (v1) endpoints used:
//   GET  /api/v1/workflows           — list (check auth)
//   POST /api/v1/workflows           — create new workflow
//
// NOTE: As of n8n 2.x the public API supports creating workflows via
// POST /api/v1/workflows with the full workflow object in the body.
// If your instance does not expose the API, enable it via:
//   Settings → n8n API → Enable API
//
// Reference: https://docs.n8n.io/api/

const API_BASE = `${N8N_BASE_URL}/api/v1`;

async function apiRequest(method, path, body) {
  const url = `${API_BASE}${path}`;
  const options = {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-N8N-API-KEY': N8N_API_KEY,
    },
  };
  if (body) options.body = JSON.stringify(body);

  const res = await fetch(url, options);
  const text = await res.text();

  let data;
  try { data = JSON.parse(text); } catch { data = { raw: text }; }

  return { status: res.status, ok: res.ok, data };
}

async function main() {
  // 1. Health-check: verify API key works
  console.log(`\n🔗 Connecting to n8n at ${N8N_BASE_URL}…`);
  const health = await apiRequest('GET', '/workflows?limit=1');

  if (health.status === 401) {
    console.error('❌  Authentication failed — check N8N_API_KEY in .env.local');
    process.exit(1);
  }
  if (!health.ok) {
    console.error(`❌  n8n API returned HTTP ${health.status}`);
    console.error('   Possible causes:');
    console.error('   • n8n is not running at N8N_BASE_URL');
    console.error('   • Public API is disabled (Settings → n8n API → Enable)');
    console.error('   • Reverse proxy strips the X-N8N-API-KEY header');
    console.error('\n   Raw response:', JSON.stringify(health.data, null, 2));
    printManualInstructions();
    process.exit(1);
  }
  console.log('   ✅ Connected to n8n API');

  // 2. Create workflow
  console.log('\n📤 Importing workflow…');

  // Remove id so n8n assigns a new one (avoids conflicts on re-import)
  const payload = { ...workflowJson };
  delete payload.id;

  const result = await apiRequest('POST', '/workflows', payload);

  if (result.ok) {
    const id  = result.data.id;
    const url = `${N8N_BASE_URL}/workflow/${id}`;
    console.log(`\n✅ Workflow imported successfully!`);
    console.log(`   ID : ${id}`);
    console.log(`   URL: ${url}`);
    console.log('\n⚠️  Next steps:');
    console.log('   1. Open the workflow in n8n UI and configure credentials:');
    console.log('      • Microsoft Outlook OAuth2 (for support@tooba.com)');
    console.log('      • OpenAI API key');
    console.log('      • Slack OAuth2 or Bot token');
    console.log('   2. Set SLACK_CHANNEL_ID in the n8n environment or as an n8n Variable.');
    console.log('   3. Activate the workflow (toggle in top-right of workflow editor).');
  } else {
    console.error(`❌  Import failed — HTTP ${result.status}`);
    console.error(JSON.stringify(result.data, null, 2));
    printManualInstructions();
    process.exit(1);
  }
}

function printManualInstructions() {
  console.log('\n📖 Manual import instructions:');
  console.log('   1. Open your n8n instance in a browser.');
  console.log('   2. Go to Workflows → ⊕ New Workflow.');
  console.log('   3. Click the menu (⋯) → Import from File.');
  console.log('   4. Select: workflows/tooba-support-ai-n8n.workflow.json');
  console.log('   5. Save and configure credentials as described in README.md.');
}

main().catch(err => {
  console.error('❌  Unexpected error:', err.message);
  process.exit(1);
});
