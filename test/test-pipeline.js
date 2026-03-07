'use strict';
/**
 * Full pipeline test — stages 1-6 + orchestrator
 * Stage 2 (OpenAI introspect) is bypassed via pre-seeded intent
 * since the OpenAI key has a quota issue.
 */

const { intercept }          = require('../src/pipeline/1-intercept');
const { research }           = require('../src/pipeline/3-research');
const { trace }              = require('../src/pipeline/4-trace');
const { adjudicate, computeFallbackVerdict } = require('../src/pipeline/5-adjudicate');
const { enforce }            = require('../src/pipeline/6-enforce');
const payload                = require('./mock-payload.json');

const PASS = '✓';
const FAIL = '✗';
let failures = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
  } else {
    console.error(`  ${FAIL} FAIL: ${label}`);
    failures++;
  }
}

async function run() {
  console.log('\n══════════════════════════════════════════════════════');
  console.log('  Argus Full Pipeline Test (Stages 1-6 + Orchestrator)');
  console.log('══════════════════════════════════════════════════════\n');

  // Stages 1-4
  const ctx = {};
  intercept(ctx, payload);
  ctx.intent = {
    taskType:             'Individualized Pricing',
    riskIndicators:       ['Automated Decision-Making', 'PII Processing', 'Behavioral Profiling', 'Individualized Pricing'],
    modelsMentioned:      ['DynamicPricing_v1'],
    dataSourcesMentioned: ['UserVault'],
    summary:              'Deploys DynamicPricing_v1 using browsing history and location data on California+EU users.',
  };
  await research(ctx);
  await trace(ctx);

  // ── Stage 5: Adjudicate ────────────────────────────────────────────────────
  console.log('\nStage 5 — Adjudicate');
  await adjudicate(ctx);

  assert(ctx.verdict !== undefined,                           'ctx.verdict populated');
  assert(['MERGE','BLOCK','ESC_HUMAN'].includes(ctx.verdict.decision), 'decision is valid enum');
  assert(typeof ctx.verdict.overallScore === 'number',        'overallScore is number');
  assert(ctx.verdict.overallScore >= 0 && ctx.verdict.overallScore <= 1, 'overallScore 0-1 range');
  assert(typeof ctx.verdict.legalRisk === 'number',           'legalRisk is number');
  assert(typeof ctx.verdict.architecturalExposure === 'number', 'architecturalExposure is number');
  assert(typeof ctx.verdict.reasoning === 'string' && ctx.verdict.reasoning.length > 10, 'reasoning is non-empty string');
  assert(Array.isArray(ctx.verdict.citations),                'citations is array');
  assert(Array.isArray(ctx.verdict.recommendations),          'recommendations is array');
  assert(Array.isArray(ctx.verdict.jurisdictionBreakdown),    'jurisdictionBreakdown is array');

  // For DynamicPricing+California+UserVault(PII) — should be BLOCK
  assert(ctx.verdict.decision === 'BLOCK',                    'DynamicPricing+CA+PII = BLOCK decision');
  assert(ctx.verdict.overallScore >= 0.65,                    'risk score >= 0.65 for a BLOCK');

  const caBreakdown = ctx.verdict.jurisdictionBreakdown?.find(j => j.jurisdiction === 'California');
  assert(caBreakdown?.decision === 'BLOCK',                   'California jurisdiction = BLOCK');

  // ── Stage 6: Enforce ───────────────────────────────────────────────────────
  console.log('\nStage 6 — Enforce');
  enforce(ctx);

  assert(ctx.enforcement !== undefined,                       'ctx.enforcement populated');
  assert(ctx.enforcement.decision === ctx.verdict.decision,  'enforcement.decision matches verdict.decision');
  assert(typeof ctx.enforcement.enforcedAt === 'string',     'enforcedAt is timestamp string');

  // ── Orchestrator unit test ─────────────────────────────────────────────────
  console.log('\nOrchestrator (pipeline/index.js)');
  const runPipeline = require('../src/pipeline/index');
  const ctx2 = await runPipeline(payload);

  assert(ctx2.pr?.number === 102,             'orchestrator: ctx.pr populated');
  assert(Array.isArray(ctx2.jurisdictions),   'orchestrator: ctx.jurisdictions populated');
  assert(ctx2.legalFindings?.length > 0,      'orchestrator: legalFindings populated');
  assert(ctx2.graphEvidence !== undefined,    'orchestrator: graphEvidence populated');
  assert(ctx2.verdict?.decision !== undefined,'orchestrator: verdict present');
  assert(['MERGE','BLOCK','ESC_HUMAN'].includes(ctx2.verdict.decision), 'orchestrator: decision valid');

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════════════════');
  if (failures === 0) {
    console.log('  ALL TESTS PASSED ✓');
  } else {
    console.error(`  ${failures} TEST(S) FAILED`);
    process.exit(1);
  }
  console.log('══════════════════════════════════════════════════════\n');

  console.log('Final verdict snapshot:');
  console.log('  decision:   ', ctx.verdict.decision);
  console.log('  score:      ', ctx.verdict.overallScore);
  console.log('  legalRisk:  ', ctx.verdict.legalRisk);
  console.log('  archExposure:', ctx.verdict.architecturalExposure);
  console.log('  source:     ', ctx.verdict._source);
  console.log('  CA decision:', caBreakdown?.decision);
  console.log('  reasoning:  ', ctx.verdict.reasoning?.slice(0, 120));
  console.log('\n  Recommendations:');
  ctx.verdict.recommendations?.forEach((r, i) => console.log(`    ${i+1}. ${r}`));
}

run().catch((err) => {
  console.error('FATAL test error:', err);
  process.exit(1);
});
