'use strict';

/**
 * src/services/openai.js — backwards-compatibility shim
 *
 * Pipeline stages that previously imported the raw OpenAI client here now use
 * src/llm/client.js directly. This file re-exports the underlying client from
 * the wrapper so any remaining imports don't break at startup.
 *
 * Prefer importing from '../llm/client' in new code.
 */

const { _client } = require('../llm/client');

module.exports = _client;
