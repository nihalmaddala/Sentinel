#!/usr/bin/env node
'use strict';

/**
 * scripts/llmSmoke.js — LLM smoke test
 *
 * Usage:
 *   npm run llm:smoke
 *   node scripts/llmSmoke.js
 *
 * Reads the same config/env as the server. Sends a minimal test call to
 * the active LLM provider and prints pass/fail with timing.
 *
 * Exit code 0 = success, 1 = failure.
 */

// Load .env before anything else
require('dotenv').config();

const { chat, json, MODELS } = require('../src/llm/client');
const config = require('../src/config');
const { z } = require('zod');

const PASS = '\x1b[32m✓ PASS\x1b[0m';
const FAIL = '\x1b[31m✗ FAIL\x1b[0m';

async function runSmoke() {
  console.log(`\n[llm:smoke] Provider : ${config.llm.provider}`);
  console.log(`[llm:smoke] Model    : ${MODELS.mini}`);
  console.log(`[llm:smoke] Base URL : ${config.llm.provider === 'openrouter' ? config.llm.openrouterBaseURL : 'https://api.openai.com/v1'}`);
  console.log('');

  let allPassed = true;

  // ── Test 1: raw chat() ────────────────────────────────────────────────────
  {
    const label = 'chat() — raw completion';
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
      console.log(`  ${PASS}  ${label}  (${latency}ms)  response="${text}"`);
    } catch (err) {
      const latency = Date.now() - start;
      console.error(`  ${FAIL}  ${label}  (${latency}ms)  error="${err.message}"`);
      allPassed = false;
    }
  }

  // ── Test 2: json() — schema validation ───────────────────────────────────
  {
    const label = 'json() — schema validation';
    const start = Date.now();
    const schema = z.object({
      status:  z.literal('ok'),
      message: z.string(),
    });

    try {
      const result = await json({
        model:  MODELS.mini,
        system: 'You return JSON only. Respond with this exact json object: {"status":"ok","message":"smoke test passed"}',
        user:   'Run smoke test.',
        schema,
        temperature: 0,
        max_tokens: 30,
      });
      const latency = Date.now() - start;
      if (result.ok) {
        console.log(`  ${PASS}  ${label}  (${latency}ms)  data=${JSON.stringify(result.data)}`);
      } else if (result.error) {
        console.error(`  ${FAIL}  ${label}  (${latency}ms)  call error: ${result.error}`);
        allPassed = false;
      } else {
        console.error(`  ${FAIL}  ${label}  (${latency}ms)  schema mismatch — missing_fields: ${result.missing_fields.join(', ')}`);
        allPassed = false;
      }
    } catch (err) {
      const latency = Date.now() - start;
      console.error(`  ${FAIL}  ${label}  (${latency}ms)  error="${err.message}"`);
      allPassed = false;
    }
  }

  // ── Test 3: MODELS config check ───────────────────────────────────────────
  {
    const label = 'MODELS config — all three model IDs present';
    const allSet = MODELS.main && MODELS.mini && MODELS.extractor;
    if (allSet) {
      console.log(`  ${PASS}  ${label}`);
      console.log(`           main=${MODELS.main}  mini=${MODELS.mini}  extractor=${MODELS.extractor}`);
    } else {
      console.error(`  ${FAIL}  ${label}`);
      allPassed = false;
    }
  }

  console.log('');
  if (allPassed) {
    console.log(`\x1b[32m[llm:smoke] All tests passed ✓\x1b[0m`);
    process.exit(0);
  } else {
    console.error(`\x1b[31m[llm:smoke] One or more tests failed ✗\x1b[0m`);
    process.exit(1);
  }
}

runSmoke().catch((err) => {
  console.error('[llm:smoke] Unexpected error:', err.message);
  process.exit(1);
});
