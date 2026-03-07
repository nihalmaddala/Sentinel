'use strict';

// Script to POST mock-payload.json to localhost:3000/api/webhook for local testing

const { createHmac } = require('crypto');
const path           = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const PORT           = process.env.PORT         || 3000;
const WEBHOOK_PATH   = process.env.WEBHOOK_PATH || '/api/webhook';
const WEBHOOK_SECRET = process.env.GITHUB_WEBHOOK_SECRET;
const TARGET_URL     = `http://localhost:${PORT}${WEBHOOK_PATH}`;

if (!WEBHOOK_SECRET) {
  console.error('[test-webhook] FATAL: GITHUB_WEBHOOK_SECRET must be set in .env');
  process.exit(1);
}

// Load mock payload — optionally override PR title via CLI arg
// Usage: node test/test-webhook.js [--title "PR title"] [--jurisdiction "California,EU"]
const mockPayload = require('./mock-payload.json');

// Support CLI overrides for demo flexibility
const args = process.argv.slice(2);
for (let i = 0; i < args.length; i++) {
  if (args[i] === '--title' && args[i + 1]) {
    mockPayload.pull_request.title = args[i + 1];
    i++;
  }
  if (args[i] === '--jurisdiction' && args[i + 1]) {
    const jStr = args[i + 1];
    mockPayload.pull_request.body =
      `${mockPayload.pull_request.body}\n\nJurisdiction: ${jStr}`;
    i++;
  }
  if (args[i] === '--event' && args[i + 1]) {
    mockPayload.action = args[i + 1];
    i++;
  }
}

const bodyStr = JSON.stringify(mockPayload);

// Sign payload with HMAC-SHA256 (same algorithm webhook.js verifies)
const signature = 'sha256=' + createHmac('sha256', WEBHOOK_SECRET)
  .update(bodyStr)
  .digest('hex');

async function sendWebhook() {
  console.log('[test-webhook] Sending mock PR to Argus…');
  console.log(`[test-webhook] Target: POST ${TARGET_URL}`);
  console.log(`[test-webhook] PR title: "${mockPayload.pull_request.title}"`);
  console.log(`[test-webhook] Action: ${mockPayload.action}`);
  console.log(`[test-webhook] Signature: ${signature.slice(0, 20)}…`);

  let response;
  try {
    response = await fetch(TARGET_URL, {
      method:  'POST',
      headers: {
        'Content-Type':        'application/json',
        'X-GitHub-Event':      'pull_request',
        'X-Hub-Signature-256': signature,
        'X-GitHub-Delivery':   `test-${Date.now()}`,
        'User-Agent':          'GitHub-Hookshot/test',
      },
      body: bodyStr,
    });
  } catch (err) {
    if (err.code === 'ECONNREFUSED') {
      console.error(`\n[test-webhook] ❌ Cannot reach ${TARGET_URL}`);
      console.error('[test-webhook] Is the Argus server running? Try: npm run dev');
    } else {
      console.error('[test-webhook] Request failed:', err.message);
    }
    process.exit(1);
  }

  const data = await response.json().catch(() => ({}));

  if (response.ok) {
    console.log(`\n[test-webhook] ✅ Server responded ${response.status}:`, data);
    console.log('[test-webhook] Pipeline is running asynchronously in the background.');
    console.log('[test-webhook] Check the server terminal for stage-by-stage output.');
    console.log('[test-webhook] Check GitHub Checks API — the check should update within ~15 seconds.');
  } else {
    console.error(`\n[test-webhook] ❌ Server responded ${response.status}:`, data);
    process.exit(1);
  }
}

sendWebhook().catch((err) => {
  console.error('[test-webhook] FATAL:', err.message);
  process.exit(1);
});
