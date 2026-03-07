'use strict';

const path = require('path');
const fs = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });

// Required vars — server will not start without these
const REQUIRED = ['GITHUB_APP_ID', 'GITHUB_WEBHOOK_SECRET'];
const missing = REQUIRED.filter((key) => !process.env[key]);
if (missing.length > 0) {
  console.error('[config] FATAL: Missing required environment variables:', missing.join(', '));
  process.exit(1);
}

// LLM provider selection:
//   - Set LLM_PROVIDER=openrouter  OR  set OPENROUTER_API_KEY → uses OpenRouter
//   - Default (or LLM_PROVIDER=openai) → uses OpenAI direct (requires OPENAI_API_KEY)
const LLM_PROVIDER = (() => {
  if (process.env.LLM_PROVIDER === 'openrouter') return 'openrouter';
  if (process.env.OPENROUTER_API_KEY)             return 'openrouter';
  return 'openai';
})();

if (LLM_PROVIDER === 'openai' && !process.env.OPENAI_API_KEY) {
  console.error('[config] FATAL: LLM_PROVIDER=openai but OPENAI_API_KEY is not set. Set OPENAI_API_KEY or set OPENROUTER_API_KEY to use OpenRouter.');
  process.exit(1);
}
if (LLM_PROVIDER === 'openrouter' && !process.env.OPENROUTER_API_KEY) {
  console.error('[config] FATAL: LLM_PROVIDER=openrouter but OPENROUTER_API_KEY is not set.');
  process.exit(1);
}

// Private key: two supported modes
//   GITHUB_PRIVATE_KEY      — raw PEM content (Render / any cloud env-var secret)
//   GITHUB_PRIVATE_KEY_PATH — path to .pem file (local dev)
// At least one must be present.
let privateKey;
if (process.env.GITHUB_PRIVATE_KEY) {
  // Render stores secrets as env vars. Newlines are often escaped as \n — normalise them.
  privateKey = process.env.GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n');
  console.log('[config] Private key loaded from GITHUB_PRIVATE_KEY env var');
} else if (process.env.GITHUB_PRIVATE_KEY_PATH) {
  const keyPath = path.resolve(process.cwd(), process.env.GITHUB_PRIVATE_KEY_PATH);
  if (!fs.existsSync(keyPath)) {
    console.error(`[config] FATAL: GitHub App private key not found at: ${keyPath}`);
    console.error('[config] Download the .pem from GitHub App → Settings → General → Private keys, save it in the project root, and set GITHUB_PRIVATE_KEY_PATH to the filename (e.g. ./argus-compliance.2026-02-27.private-key.pem)');
    process.exit(1);
  }
  privateKey = fs.readFileSync(keyPath, 'utf8');
  console.log('[config] Private key loaded from file:', keyPath);
} else {
  console.error('[config] FATAL: Set either GITHUB_PRIVATE_KEY (PEM content) or GITHUB_PRIVATE_KEY_PATH (file path)');
  process.exit(1);
}

// Optional vars — warn if absent but allow degraded mode
const OPTIONAL_WARN = ['TAVILY_API_KEY', 'NEO4J_URI', 'NEO4J_USERNAME', 'NEO4J_PASSWORD', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
const missingOptional = OPTIONAL_WARN.filter((key) => !process.env[key]);
if (missingOptional.length > 0) {
  console.warn('[config] WARNING: Optional vars not set (degraded mode):', missingOptional.join(', '));
}

const config = Object.freeze({
  // Server
  port: parseInt(process.env.PORT || '3000', 10),
  webhookPath: process.env.WEBHOOK_PATH || '/api/webhook',

  // GitHub App
  github: Object.freeze({
    appId: process.env.GITHUB_APP_ID,
    clientId: process.env.GITHUB_CLIENT_ID || '',
    clientSecret: process.env.GITHUB_CLIENT_SECRET || '',
    webhookSecret: process.env.GITHUB_WEBHOOK_SECRET,
    privateKey,
  }),

  // Legacy openai block — kept so any code that still reads config.openai.apiKey doesn't break
  openai: Object.freeze({
    apiKey: process.env.OPENAI_API_KEY || null,
  }),

  // ── Unified LLM config ────────────────────────────────────────────────────
  // All pipeline stages read from here via src/llm/client.js.
  // provider — which backend to call
  // model*   — OpenRouter-style IDs work for both: "gpt-4o" on OpenAI direct,
  //             "openai/gpt-4o" or "qwen/..." on OpenRouter
  llm: Object.freeze({
    provider: LLM_PROVIDER,

    // API keys (only the active provider's key is required)
    openaiApiKey:     process.env.OPENAI_API_KEY     || null,
    openrouterApiKey: process.env.OPENROUTER_API_KEY || null,

    // OpenRouter connection
    openrouterBaseURL:  process.env.OPENROUTER_BASE_URL   || 'https://openrouter.ai/api/v1',
    openrouterReferer:  process.env.OPENROUTER_REFERER     || 'http://localhost',
    openrouterAppName:  process.env.OPENROUTER_APP_NAME    || 'Argus',

    // Model IDs — defaults differ per provider so the env vars let you override
    // LLM_MODEL_MAIN     = full-power model for Stage 5 Pass 2 adjudication
    // LLM_MODEL_MINI     = cheap/fast model for Stage 2 classification + Stage 5 Pass 1
    // LLM_MODEL_EXTRACTOR= structured extraction sub-agent (OpenRouter only)
    modelMain:      process.env.LLM_MODEL_MAIN      || (LLM_PROVIDER === 'openrouter' ? 'openai/gpt-4o'      : 'gpt-4o'),
    modelMini:      process.env.LLM_MODEL_MINI      || (LLM_PROVIDER === 'openrouter' ? 'openai/gpt-4o-mini' : 'gpt-4o-mini'),
    modelExtractor: process.env.LLM_MODEL_EXTRACTOR || 'qwen/qwen3-235b-a22b',

    // Safe logging: set LLM_LOG_PROMPTS=true to log full prompts in dev (never in prod)
    logPrompts: process.env.LLM_LOG_PROMPTS === 'true',
  }),

  // Tavily (optional)
  tavily: Object.freeze({
    apiKey: process.env.TAVILY_API_KEY || null,
  }),

  // Neo4j (optional)
  neo4j: Object.freeze({
    uri: process.env.NEO4J_URI || null,
    username: process.env.NEO4J_USERNAME || null,
    password: process.env.NEO4J_PASSWORD || null,
  }),

  // Supabase (optional — audit persistence)
  supabase: Object.freeze({
    url:            process.env.SUPABASE_URL             || null,
    serviceRoleKey: process.env.SUPABASE_SERVICE_ROLE_KEY || null,
  }),

  // Enforcement policy (optional — comma-separated list overrides the built-in high-risk task list)
  enforcement: Object.freeze({
    highRiskTasks: process.env.ARGUS_HIGH_RISK_TASKS
      ? process.env.ARGUS_HIGH_RISK_TASKS.split(',').map((t) => t.trim()).filter(Boolean)
      : null, // null = use built-in default list in 5-adjudicate.js
  }),
});

module.exports = config;
