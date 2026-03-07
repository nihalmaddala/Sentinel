'use strict';

/**
 * src/llm/client.js — Unified LLM wrapper for Argus
 *
 * Single module used by every pipeline stage. Switching providers is one
 * env var: set OPENROUTER_API_KEY (or LLM_PROVIDER=openrouter) to route
 * all calls through OpenRouter; omit it to use OpenAI direct.
 *
 * Exports:
 *   chat(opts)  — raw chat completion, returns OpenAI response object
 *   json(opts)  — JSON-mode call with Zod schema validation + repair retry
 *   MODELS      — { main, mini, extractor } model ID strings
 */

const OpenAI = require('openai');
const { z }  = require('zod');
const config = require('../config');

// ── Build the underlying OpenAI-compatible client ────────────────────────────

function buildClient() {
  const { llm } = config;

  if (llm.provider === 'openrouter') {
    return new OpenAI.default({
      apiKey:  llm.openrouterApiKey,
      baseURL: llm.openrouterBaseURL,
      defaultHeaders: {
        'HTTP-Referer':  llm.openrouterReferer,
        'X-Title':       llm.openrouterAppName,
      },
    });
  }

  return new OpenAI.default({ apiKey: llm.openaiApiKey });
}

const _client = buildClient();

// ── Model aliases (read once at startup) ─────────────────────────────────────

const MODELS = Object.freeze({
  main:      config.llm.modelMain,
  mini:      config.llm.modelMini,
  extractor: config.llm.modelExtractor,
});

console.log(`[llm] Provider: ${config.llm.provider} | main=${MODELS.main} | mini=${MODELS.mini}`);

// ── Error normalisation ───────────────────────────────────────────────────────

function normalizeError(err, context) {
  const status  = err.status  || err.response?.status  || 500;
  const code    = err.code    || err.error?.code        || null;
  const details = err.error?.message || err.message     || 'Unknown LLM error';

  const out = new Error(`[llm:${context}] ${details}`);
  out.provider = config.llm.provider;
  out.status   = status;
  out.code     = code;
  out.details  = details;
  return out;
}

// ── Retry policy ─────────────────────────────────────────────────────────────
// Retry once (with backoff) on transient errors. Never retry auth/bad-request.

const RETRYABLE_STATUSES = new Set([429, 500, 503, 524]);

async function withRetry(fn, label, maxAttempts = 2) {
  let lastErr;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      const status = err.status || err.response?.status;
      if (!RETRYABLE_STATUSES.has(status)) {
        throw normalizeError(err, label);
      }
      lastErr = err;
      if (attempt < maxAttempts - 1) {
        const delay = Math.pow(2, attempt) * 1200; // 1.2s, 2.4s
        console.warn(`[llm:${label}] Retrying in ${delay}ms (attempt ${attempt + 2}/${maxAttempts}) — status ${status}`);
        await new Promise((r) => setTimeout(r, delay));
      }
    }
  }
  throw normalizeError(lastErr, label);
}

// ── Safe logging helper ───────────────────────────────────────────────────────

function logCall(label, model, maxTokens, messages) {
  if (config.llm.logPrompts) {
    // Developer mode — log full prompt (never enable in prod)
    console.log(`[llm:${label}] model=${model} max_tokens=${maxTokens}`);
    console.log(`[llm:${label}] system=${messages.find(m => m.role === 'system')?.content?.slice(0, 120)}…`);
  } else {
    console.log(`[llm:${label}] provider=${config.llm.provider} model=${model} max_tokens=${maxTokens}`);
  }
}

// ── chat() ────────────────────────────────────────────────────────────────────

/**
 * Raw chat completion. Returns the full OpenAI response object.
 *
 * @param {{ model, messages, temperature?, max_tokens?, response_format? }} opts
 * @returns {Promise<import('openai').ChatCompletion>}
 */
async function chat({ model, messages, temperature = 0.1, max_tokens = 8192, response_format }) {
  logCall('chat', model, max_tokens, messages);

  return withRetry(() =>
    _client.chat.completions.create({
      model,
      messages,
      temperature,
      max_tokens,
      ...(response_format ? { response_format } : {}),
    }),
  'chat');
}

// ── json() ────────────────────────────────────────────────────────────────────

/**
 * JSON-mode call with optional Zod schema validation and auto-repair.
 *
 * Flow:
 *   1. Call LLM with response_format: json_object
 *   2. Parse JSON (repair retry if malformed)
 *   3. Validate against schema if provided
 *   4. On validation failure: re-prompt once asking model to fix the JSON
 *   5. Always return { data, ok, missing_fields, error? } — never throws on schema mismatch
 *
 * @param {{ model, system, user, schema?, temperature?, max_tokens? }} opts
 * @returns {Promise<{ data: any, ok: boolean, missing_fields: string[], error?: string }>}
 */
async function json({ model, system, user, schema, temperature = 0.1, max_tokens = 8192 }) {
  const baseMessages = [
    { role: 'system', content: system },
    { role: 'user',   content: user   },
  ];

  logCall('json', model, max_tokens, baseMessages);

  // ── Step 1: Initial call ─────────────────────────────────────────────────

  let raw;
  try {
    const response = await withRetry(() =>
      _client.chat.completions.create({
        model,
        messages:        baseMessages,
        temperature,
        max_tokens,
        response_format: { type: 'json_object' },
      }),
    'json');
    raw = response.choices[0].message.content;
  } catch (err) {
    console.error(`[llm:json] Call failed: ${err.message}`);
    return { data: null, ok: false, missing_fields: ['all'], error: err.message };
  }

  // ── Step 2: Parse JSON ───────────────────────────────────────────────────

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn('[llm:json] Initial JSON parse failed — attempting repair');
    try {
      const repair = await withRetry(() =>
        _client.chat.completions.create({
          model,
          temperature: 0,
          max_tokens,
          response_format: { type: 'json_object' },
          messages: [
            ...baseMessages,
            { role: 'assistant', content: raw },
            { role: 'user', content: 'Your response was not valid JSON. Return ONLY a valid JSON object matching the schema. No markdown, no explanation.' },
          ],
        }),
      'json-repair');
      parsed = JSON.parse(repair.choices[0].message.content);
    } catch (repairErr) {
      console.error(`[llm:json] Repair failed: ${repairErr.message}`);
      return { data: null, ok: false, missing_fields: ['all'], error: 'JSON parse failed after repair' };
    }
  }

  // ── Step 3: Schema validation ────────────────────────────────────────────

  if (!schema) return { data: parsed, ok: true, missing_fields: [] };

  const firstPass = schema.safeParse(parsed);
  if (firstPass.success) return { data: firstPass.data, ok: true, missing_fields: [] };

  const badFields = firstPass.error.issues.map((i) => i.path.join('.') || i.message);
  console.warn(`[llm:json] Schema validation failed (${badFields.length} issues): ${badFields.slice(0, 5).join(', ')}`);

  // ── Step 4: Schema-fix retry ─────────────────────────────────────────────

  try {
    const schemaHint = JSON.stringify(z.object ? schema._def : {}, null, 2).slice(0, 800);
    const fixResponse = await withRetry(() =>
      _client.chat.completions.create({
        model,
        temperature: 0,
        max_tokens,
        response_format: { type: 'json_object' },
        messages: [
          ...baseMessages,
          { role: 'assistant', content: raw },
          {
            role: 'user',
            content: `Your JSON response does not match the required schema.\nProblematic fields: ${badFields.join(', ')}\n\nFix the JSON so every field matches the schema exactly. Return ONLY valid JSON. null is acceptable for optional fields you cannot populate.`,
          },
        ],
      }),
    'json-schema-fix');

    const fixed = JSON.parse(fixResponse.choices[0].message.content);
    const secondPass = schema.safeParse(fixed);
    if (secondPass.success) {
      console.log('[llm:json] Schema fix succeeded');
      return { data: secondPass.data, ok: true, missing_fields: [] };
    }
    const remainingBad = secondPass.error.issues.map((i) => i.path.join('.') || i.message);
    console.warn(`[llm:json] Schema fix partial — still invalid: ${remainingBad.join(', ')}`);
    return { data: fixed, ok: false, missing_fields: remainingBad };

  } catch (fixErr) {
    console.error(`[llm:json] Schema-fix call failed: ${fixErr.message}`);
    return { data: parsed, ok: false, missing_fields: badFields };
  }
}

// ── Exports ──────────────────────────────────────────────────────────────────

module.exports = { chat, json, MODELS, _client };
