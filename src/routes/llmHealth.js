'use strict';

/**
 * GET /api/llm/health
 *
 * Sends a minimal test prompt to the active LLM provider and reports:
 *   { provider, model, ok, latency_ms, error? }
 *
 * Safe to call in production — uses the mini model for minimal cost/latency.
 * Does NOT log secrets or prompt content.
 */

const express = require('express');
const { chat, MODELS } = require('../llm/client');
const config = require('../config');

const router = express.Router();

router.get('/', async (_req, res) => {
  const start = Date.now();

  try {
    const response = await chat({
      model:       MODELS.mini,
      messages:    [{ role: 'user', content: 'Reply with the single word: OK' }],
      temperature: 0,
      max_tokens:  5,
    });

    const latency = Date.now() - start;
    const text    = response.choices?.[0]?.message?.content?.trim() ?? '';

    return res.json({
      provider:   config.llm.provider,
      model:      MODELS.mini,
      ok:         true,
      latency_ms: latency,
      response:   text,
    });
  } catch (err) {
    const latency = Date.now() - start;
    console.error('[llmHealth] Health check failed:', err.message);

    return res.status(500).json({
      provider:   config.llm.provider,
      model:      MODELS.mini,
      ok:         false,
      latency_ms: latency,
      error:      err.message,
    });
  }
});

module.exports = router;
