'use strict';

const express = require('express');
const config = require('./config');

// Initialise singletons at startup so connectivity issues surface early
require('./llm/client');       // unified LLM wrapper (picks provider from config)
require('./services/tavily');
require('./services/neo4j');

const app = express();

// ── Raw body parsing on the webhook route ─────────────────────────────────────
// MUST come before express.json(). The raw Buffer is needed for HMAC-SHA256
// signature verification in src/github/webhook.js.
app.use(
  config.webhookPath,
  express.raw({ type: 'application/json' })
);

// ── JSON body parsing for all other routes ────────────────────────────────────
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.json({
    service: 'Sentinel Security Gatekeeper',
    status: 'ok',
    version: '1.0.0',
  });
});

// ── LLM health endpoint ───────────────────────────────────────────────────────
app.use('/api/llm/health', require('./routes/llmHealth'));

// ── Webhook route ─────────────────────────────────────────────────────────────
const { router: webhookRouter } = require('./github/webhook');
app.use(config.webhookPath, webhookRouter);

// ── Start ─────────────────────────────────────────────────────────────────────
app.listen(config.port, () => {
  console.log(`[sentinel] Server listening on port ${config.port}`);
  console.log(`[sentinel] Webhook endpoint: POST ${config.webhookPath}`);
});

module.exports = app;
