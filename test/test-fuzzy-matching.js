'use strict';
/**
 * Test — Fuzzy model name matching in Stage 4 (Trace)
 *
 * Validates that partial, versioned, and case-variant model names
 * still resolve to the correct infrastructure lineage, both via
 * Neo4j queries (if available) and the static fallback.
 */

const { trace } = require('../src/pipeline/4-trace');

const PASS = '\u2713';
const FAIL = '\u2717';
let failures = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
  } else {
    console.error(`  ${FAIL} FAIL: ${label}`);
    failures++;
  }
}

/**
 * Build a minimal pipeline context with a given model name and task type.
 */
function buildCtx(modelsMentioned, taskType = 'Unknown') {
  return {
    pr: { number: 999, title: 'test PR' },
    jurisdictions: ['California', 'EU'],
    intent: {
      taskType,
      riskIndicators: ['PII Processing'],
      modelsMentioned,
      dataSourcesMentioned: [],
      summary: 'Test scenario',
    },
  };
}

async function run() {
  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  console.log('  Argus — Fuzzy Model Name Matching Tests');
  console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');

  // ── 1. Exact match still works (regression check) ─────────────────────────
  console.log('1. Exact model name (regression check)');
  {
    const ctx = buildCtx(['DynamicPricing_v1']);
    await trace(ctx);
    assert(ctx.graphEvidence.pathsFound.length > 0,       'DynamicPricing_v1 (exact) → paths found');
    assert(ctx.graphEvidence.riskLevel !== 'None',         'DynamicPricing_v1 (exact) → risk detected');
    assert(ctx.graphEvidence.sensitiveData.includes('PII'),'DynamicPricing_v1 (exact) → PII detected');
  }

  // ── 2. Partial name without version suffix ────────────────────────────────
  console.log('\n2. Partial name — no version suffix');
  {
    const ctx = buildCtx(['DynamicPricing']);
    await trace(ctx);
    assert(ctx.graphEvidence.pathsFound.length > 0,        'DynamicPricing → paths found (fuzzy match to DynamicPricing_v1)');
    assert(ctx.graphEvidence.riskLevel !== 'None',          'DynamicPricing → risk detected');
  }

  // ── 3. Lowercase variant ──────────────────────────────────────────────────
  console.log('\n3. Lowercase variant');
  {
    const ctx = buildCtx(['dynamicpricing_v1']);
    await trace(ctx);
    assert(ctx.graphEvidence.pathsFound.length > 0,        'dynamicpricing_v1 → paths found (case-insensitive)');
    assert(ctx.graphEvidence.riskLevel !== 'None',          'dynamicpricing_v1 → risk detected');
  }

  // ── 4. Partial + lowercase ────────────────────────────────────────────────
  console.log('\n4. Partial + lowercase');
  {
    const ctx = buildCtx(['dynamicpricing']);
    await trace(ctx);
    assert(ctx.graphEvidence.pathsFound.length > 0,        'dynamicpricing → paths found');
    assert(ctx.graphEvidence.riskLevel !== 'None',          'dynamicpricing → risk detected');
  }

  // ── 5. FaceMatch partial ──────────────────────────────────────────────────
  console.log('\n5. FaceMatch partial name');
  {
    const ctx = buildCtx(['FaceMatch']);
    await trace(ctx);
    assert(ctx.graphEvidence.pathsFound.length > 0,        'FaceMatch → paths found (fuzzy match to FaceMatch_v2)');
    assert(ctx.graphEvidence.sensitiveData.some(
      (d) => d === 'Biometric' || d === 'PII'),            'FaceMatch → Biometric or PII detected');
  }

  // ── 6. FraudSentinel partial ──────────────────────────────────────────────
  console.log('\n6. FraudSentinel partial name');
  {
    const ctx = buildCtx(['FraudSentinel']);
    await trace(ctx);
    assert(ctx.graphEvidence.pathsFound.length > 0,        'FraudSentinel → paths found (fuzzy match to FraudSentinel_v3)');
  }

  // ── 7. Task type fallback with partial model name ─────────────────────────
  console.log('\n7. Task type fallback (no model name, fuzzy task type)');
  {
    const ctx = buildCtx([], 'Individualized Pricing');
    await trace(ctx);
    assert(ctx.graphEvidence.pathsFound.length > 0,        'Task "Individualized Pricing" → paths found via task fallback');
  }

  // ── 8. Unknown model name should return no paths (no false positives) ─────
  console.log('\n8. Unknown model name (no false positives)');
  {
    const ctx = buildCtx(['CompletelyUnknownModel_v99']);
    await trace(ctx);
    assert(ctx.graphEvidence.pathsFound.length === 0,      'Unknown model → no paths (no false positive)');
    assert(ctx.graphEvidence.riskLevel === 'None',          'Unknown model → risk level None');
  }

  // ── 9. CreditPredict partial ──────────────────────────────────────────────
  console.log('\n9. CreditPredict partial name');
  {
    const ctx = buildCtx(['CreditPredict']);
    await trace(ctx);
    assert(ctx.graphEvidence.pathsFound.length > 0,        'CreditPredict → paths found (fuzzy match to CreditPredict_v1)');
    assert(ctx.graphEvidence.sensitiveData.some(
      (d) => d === 'Financial' || d === 'PII' || d === 'Behavioral'),
      'CreditPredict → Financial/PII/Behavioral detected');
  }

  // ── 10. Llama partial ─────────────────────────────────────────────────────
  console.log('\n10. Llama partial name (safe model)');
  {
    const ctx = buildCtx(['Llama_3']);
    await trace(ctx);
    // Llama_3_Recommender only touches anonymized data — should find paths but no sensitive data
    assert(ctx.graphEvidence.pathsFound.length === 0 ||
      ctx.graphEvidence.riskLevel === 'None',              'Llama_3 → no sensitive risk (anonymized only)');
  }

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log('\n\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550');
  if (failures === 0) {
    console.log('  ALL FUZZY MATCHING TESTS PASSED \u2713');
  } else {
    console.error(`  ${failures} TEST(S) FAILED`);
    process.exit(1);
  }
  console.log('\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n');
}

run().catch((err) => {
  console.error('FATAL test error:', err);
  process.exit(1);
});
