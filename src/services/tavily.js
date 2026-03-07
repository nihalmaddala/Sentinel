'use strict';

const { tavily } = require('@tavily/core');
const config = require('../config');

let tavilyClient = null;

if (config.tavily.apiKey) {
  tavilyClient = tavily({ apiKey: config.tavily.apiKey });
  console.log('[tavily] Client initialised');
} else {
  console.warn('[tavily] No API key — research stage will return placeholder data');
}

module.exports = tavilyClient;
