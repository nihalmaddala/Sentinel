'use strict';

// Orchestrator — prompt injection scan only, no compliance stages

const { intercept }        = require('./1-intercept');
const { enforce }          = require('./6-enforce');
const { scanForInjection } = require('../attacker/injection-scanner');

/**
 * Run the Sentinel injection-scan pipeline.
 *
 * Flow: Intercept → Injection Scan → Enforce
 * All legal compliance stages (Introspect, Research, Trace, Adjudicate) removed.
 *
 * @param {object} payload  Raw GitHub webhook pull_request payload
 * @returns {Promise<object>}  Final pipeline context with .verdict and .enforcement
 */
async function runPipeline(payload) {
  const start = Date.now();
  console.log('\n[pipeline] ══════════════════════════════════════');
  console.log('[pipeline] Sentinel Pipeline — Starting Run');
  console.log('[pipeline] ══════════════════════════════════════\n');

  const ctx = {};

  try {
    // ── Stage 1: Intercept ──────────────────────────────────────────────────
    intercept(ctx, payload);

    // ── Stage 2: Prompt Injection Scan ──────────────────────────────────────
    await scanForInjection(ctx);

    const status = ctx.injectionReport?.status;

    if (status === 'BLOCKED' || status === 'CRITICAL') {
      console.log(`[pipeline] 🚨 Injection ${status} — forcing BLOCK`);
      ctx.verdict = {
        decision:              'BLOCK',
        overallScore:          1.0,
        legalRisk:             0,
        architecturalExposure: 0,
        confidence:            1.0,
        reasoning:             status === 'CRITICAL'
          ? 'SECURITY VIOLATION: Prompt injection attack bypassed AI defenses. This PR must be blocked.'
          : 'SECURITY VIOLATION: Prompt injection attack detected and neutralized. This PR is blocked.',
        citations:             [],
        recommendations:       [
          'Remove all prompt injection payloads from code comments, strings, and annotations.',
          'Review the PR for malicious intent before re-submitting.',
        ],
        jurisdictionBreakdown: [],
        _source:               'injection-scanner',
      };
    } else {
      console.log('[pipeline] ✅ No injection detected — MERGE allowed');
      ctx.verdict = {
        decision:              'MERGE',
        overallScore:          0,
        legalRisk:             0,
        architecturalExposure: 0,
        confidence:            1.0,
        reasoning:             'No prompt injection patterns detected. PR is clean.',
        citations:             [],
        recommendations:       [],
        jurisdictionBreakdown: [],
        _source:               'injection-scanner',
      };
    }

    // ── Stage 3: Enforce ────────────────────────────────────────────────────
    enforce(ctx);

  } catch (err) {
    console.error('[pipeline] FATAL error:', err.message);
    console.error(err.stack);

    if (!ctx.verdict) {
      ctx.verdict = {
        decision:              'ESC_HUMAN',
        overallScore:          0,
        legalRisk:             0,
        architecturalExposure: 0,
        reasoning:             `Pipeline error: ${err.message}. Manual review required.`,
        citations:             [],
        recommendations:       ['Contact the Sentinel team to investigate the pipeline failure.'],
        jurisdictionBreakdown: [],
        _source:               'error-fallback',
      };
    }
  }

  const elapsed = ((Date.now() - start) / 1000).toFixed(2);
  console.log(`\n[pipeline] ══════════════════════════════════════`);
  console.log(`[pipeline] Run complete in ${elapsed}s — decision: ${ctx.verdict?.decision}`);
  console.log(`[pipeline] ══════════════════════════════════════\n`);

  return ctx;
}

module.exports = runPipeline;
