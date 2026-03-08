'use strict';

// Orchestrator — runs stages 1-6 sequentially, returns final context

const { buildFeatureContext } = require('./0-feature-context');
const { intercept }   = require('./1-intercept');
const { introspect }  = require('./2-introspect');
const { research }    = require('./3-research');
const { trace }       = require('./4-trace');
const { adjudicate }  = require('./5-adjudicate');
const { enforce }     = require('./6-enforce');
const { saveVerdict, saveIssue } = require('../services/supabase');
const { feedbackLoop }           = require('./neo4j-feedback');
const { scanForInjection }       = require('../attacker/injection-scanner');

/**
 * Run the full 6-stage Argus autonomic compliance pipeline.
 *
 * Stages are run sequentially — each stage mutates and enriches the
 * context object that is threaded through all stages.
 *
 * Flow: Intercept → Introspect → Research → Trace → Adjudicate → Enforce
 *
 * @param {object} payload  Raw GitHub webhook pull_request payload
 * @returns {Promise<object>}  Final pipeline context with .verdict and .enforcement
 */
async function runPipeline(payload) {
  const start = Date.now();
  console.log('\n[pipeline] ══════════════════════════════════════');
  console.log('[pipeline] Argus Autonomic Loop — Starting Run');
  console.log('[pipeline] ══════════════════════════════════════\n');

  const ctx = {};

  try {
    // ── Stage 1: Intercept ──────────────────────────────────────────────────
    intercept(ctx, payload);

    // ── Security: Prompt Injection Scan ─────────────────────────────────────
    // Runs before any LLM stage — scans the diff for injection attempts
    // and live-probes GPT-4o to confirm if the attack would succeed.
    await scanForInjection(ctx);

    // If ANY injection detected — stop the pipeline immediately, don't run compliance stages
    if (ctx.injectionReport?.status === 'BLOCKED' || ctx.injectionReport?.status === 'CRITICAL') {
      const isCritical = ctx.injectionReport.status === 'CRITICAL';
      console.log(`[pipeline] 🚨 Injection ${ctx.injectionReport.status} — halting pipeline, forcing BLOCK`);
      ctx.verdict = {
        decision:              'BLOCK',
        overallScore:          1.0,
        legalRisk:             0,
        architecturalExposure: 0,
        confidence:            1.0,
        reasoning:             isCritical
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
      enforce(ctx);
      return ctx;
    }

    // ── Feature Context Enrichment ──────────────────────────────────────────
    await buildFeatureContext(ctx);

    // ── Stage 2: Introspect ─────────────────────────────────────────────────
    await introspect(ctx);

    // ── Stage 3: Research ───────────────────────────────────────────────────
    await research(ctx);

    // ── Stage 4: Trace ──────────────────────────────────────────────────────
    await trace(ctx);

    // ── Stage 5: Adjudicate ─────────────────────────────────────────────────
    await adjudicate(ctx);

    // ── Stage 6: Enforce ────────────────────────────────────────────────────
    enforce(ctx);

    // ── Stage 7: Persist ────────────────────────────────────────────────────
    // Fire-and-forget — Supabase writes don't block the GitHub response
    (async () => {
      try {
        const verdictId = await saveVerdict(ctx);
        if (verdictId && ctx.verdict.decision !== 'MERGE') {
          await saveIssue(ctx, verdictId);
        }
      } catch (persistErr) {
        console.error('[pipeline] Supabase persist error (non-fatal):', persistErr.message);
      }
    })();

    // ── Stage 8: Neo4j Feedback Loop ────────────────────────────────────────
    // Fire-and-forget — write newly discovered models/databases/data flows
    // back into the graph so future traces are more accurate.
    (async () => {
      try {
        await feedbackLoop(ctx);
      } catch (feedbackErr) {
        console.error('[pipeline] Graph feedback error (non-fatal):', feedbackErr.message);
      }
    })();

  } catch (err) {
    console.error('[pipeline] FATAL error in pipeline stage:', err.message);
    console.error(err.stack);

    // Ensure verdict always exists so webhook.js can update the check
    if (!ctx.verdict) {
      ctx.verdict = {
        decision: 'ESC_HUMAN',
        overallScore: 0,
        legalRisk: 0,
        architecturalExposure: 0,
        reasoning: `Pipeline encountered a fatal error: ${err.message}. Manual review required.`,
        citations: [],
        recommendations: ['Contact the Argus team to investigate the pipeline failure.'],
        jurisdictionBreakdown: [],
        _source: 'error-fallback',
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
