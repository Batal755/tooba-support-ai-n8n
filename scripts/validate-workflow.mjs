#!/usr/bin/env node
/**
 * validate-workflow.mjs
 *
 * Run: npm run validate
 *
 * 1. Validates that the workflow JSON parses correctly.
 * 2. Scans the entire repository for known secret patterns.
 *    Fails with exit code 1 if any are found.
 */

import { readFileSync, readdirSync, statSync } from 'fs';
import { join, relative } from 'path';
import { fileURLToPath } from 'url';

const __dirname = fileURLToPath(new URL('.', import.meta.url));
const ROOT = join(__dirname, '..');
const WORKFLOW_PATH = join(ROOT, 'workflows', 'tooba-support-ai-n8n.workflow.json');

// ── 1. Validate workflow JSON ─────────────────────────────────────────
console.log('📋 Validating workflow JSON…');

let workflow;
try {
  const raw = readFileSync(WORKFLOW_PATH, 'utf8');
  workflow = JSON.parse(raw);
  console.log(`   ✅ Valid JSON — workflow name: "${workflow.name}"`);
  console.log(`   ✅ Node count: ${workflow.nodes?.length ?? 0}`);
} catch (err) {
  console.error(`   ❌ Workflow JSON parse error: ${err.message}`);
  process.exit(1);
}

// ── 2. Secret pattern scan ────────────────────────────────────────────
console.log('\n🔍 Scanning repository for secret patterns…');

const SECRET_PATTERNS = [
  { pattern: /sk-[A-Za-z0-9]{20,}/g,         label: 'OpenAI API key (sk-)' },
  { pattern: /xoxb-[A-Za-z0-9-]{24,}/g,       label: 'Slack Bot token (xoxb-)' },
  { pattern: /xoxp-[A-Za-z0-9-]{24,}/g,       label: 'Slack User token (xoxp-)' },
  { pattern: /xoxa-[A-Za-z0-9-]{24,}/g,       label: 'Slack App token (xoxa-)' },
  { pattern: /xoxe-[A-Za-z0-9-]{24,}/g,       label: 'Slack token (xoxe-)' },
  { pattern: /Bearer\s+ey[A-Za-z0-9_-]{20,}/g, label: 'JWT Bearer token' },
  { pattern: /eyJ[A-Za-z0-9_-]{40,}/g,        label: 'Raw JWT (eyJ…)' },
  { pattern: /"client_secret"\s*:\s*"[^"]{8,}"/g, label: 'client_secret field' },
  { pattern: /"refresh_token"\s*:\s*"[^"]{8,}"/g, label: 'refresh_token field' },
  { pattern: /"access_token"\s*:\s*"[^"]{8,}"/g,  label: 'access_token field' },
  { pattern: /CONFIGURE_ME_[A-Z0-9_]+/g,      label: 'Placeholder not replaced' },
];

// Directories / files to skip
const SKIP_DIRS  = new Set(['node_modules', '.git', 'dist', '.cache']);
const SKIP_FILES = new Set([
  'validate-workflow.mjs',  // this file contains the pattern strings themselves
  '.env.example',           // intentionally contains placeholder names
]);

function collectFiles(dir) {
  const results = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const st = statSync(full);
    if (st.isDirectory()) {
      if (!SKIP_DIRS.has(entry)) results.push(...collectFiles(full));
    } else {
      if (!SKIP_FILES.has(entry)) results.push(full);
    }
  }
  return results;
}

const files = collectFiles(ROOT);
let violations = 0;

for (const file of files) {
  let content;
  try {
    content = readFileSync(file, 'utf8');
  } catch {
    continue; // binary file — skip
  }

  for (const { pattern, label } of SECRET_PATTERNS) {
    pattern.lastIndex = 0;
    const matches = content.match(pattern);
    if (matches) {
      console.error(
        `   ❌ ${label} found in ${relative(ROOT, file)} (${matches.length} match(es))`
      );
      violations++;
    }
  }
}

if (violations > 0) {
  console.error(`\n🚨 Validation FAILED — ${violations} secret violation(s) found.`);
  console.error(
    '   Remove all secrets before committing. Use n8n credentials instead.'
  );
  process.exit(1);
}

console.log(`   ✅ No secret patterns found across ${files.length} files.`);

// ── 3. Structural checks ──────────────────────────────────────────────
console.log('\n🏗️  Checking workflow structure…');

const checks = [
  { test: () => !!workflow.name,              msg: 'workflow.name is set' },
  { test: () => Array.isArray(workflow.nodes), msg: 'workflow.nodes is an array' },
  { test: () => typeof workflow.connections === 'object', msg: 'workflow.connections is an object' },
  { test: () => workflow.active === false,    msg: 'workflow.active is false (safe default)' },
  {
    test: () => workflow.nodes?.some(n => n.type?.includes('microsoftOutlook')),
    msg: 'Outlook Trigger node present',
  },
  {
    test: () => workflow.nodes?.some(n => n.type === 'n8n-nodes-base.slack'),
    msg: 'Slack node present',
  },
  {
    test: () => workflow.nodes?.some(n => n.type === 'n8n-nodes-base.httpRequest'),
    msg: 'HTTP Request node present (OpenAI / Graph API)',
  },
  {
    test: () => workflow.nodes?.some(n => n.type === 'n8n-nodes-base.code'),
    msg: 'Code node present',
  },
  {
    // Require 20+ chars after sk- so documentation references like "sk-…" don't fire
    test: () => !/sk-[A-Za-z0-9]{20,}/.test(JSON.stringify(workflow)),
    msg: 'No OpenAI key in workflow JSON',
  },
  {
    // Require 24+ chars after xoxb- so documentation references like "xoxb-…" don't fire
    test: () => !/xoxb-[A-Za-z0-9-]{24,}/.test(JSON.stringify(workflow)),
    msg: 'No Slack token in workflow JSON',
  },
];

let checkFails = 0;
for (const { test, msg } of checks) {
  if (test()) {
    console.log(`   ✅ ${msg}`);
  } else {
    console.error(`   ❌ FAIL: ${msg}`);
    checkFails++;
  }
}

if (checkFails > 0) {
  console.error(`\n🚨 ${checkFails} structural check(s) failed.`);
  process.exit(1);
}

console.log('\n✅ All validations passed.\n');
