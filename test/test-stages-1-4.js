'use strict';
/**
 * Incremental test runner — validates Stages 1-4 without needing OpenAI quota.
 * Stage 2 intent is mocked with the expected DynamicPricing scenario.
 */

const { intercept }  = require('../src/pipeline/1-intercept');
const { research }   = require('../src/pipeline/3-research');
const { trace }      = require('../src/pipeline/4-trace');
const payload        = require('./mock-payload.json');

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
  console.log('\n══════════════════════════════════════════');
  console.log('  Argus Pipeline — Incremental Test Run');
  console.log('══════════════════════════════════════════\n');

  // ── Stage 1 ────────────────────────────────────────────────────────────────
  console.log('Stage 1 — Intercept');
  const ctx = {};
  intercept(ctx, payload);

  assert(ctx.pr?.number === 101,                          'ctx.pr.number = 101');
  assert(ctx.pr?.owner  === 'chanu1406',                  'ctx.pr.owner = chanu1406');
  assert(ctx.pr?.sha?.startsWith('abc123'),               'ctx.pr.sha populated');
  assert(Array.isArray(ctx.jurisdictions),                'ctx.jurisdictions is array');
  assert(ctx.jurisdictions.includes('California'),        'California detected');
  assert(ctx.jurisdictions.includes('EU'),                'EU detected');

  // ── Inject mock Stage 2 intent (OpenAI quota exhausted) ───────────────────
  console.log('\nStage 2 — Introspect (mocked — OpenAI quota exhausted)');
  ctx.intent = {
    taskType:             'Individualized Pricing',
    riskIndicators:       ['Automated Decision-Making', 'PII Processing', 'Behavioral Profiling', 'Individualized Pricing'],
    modelsMentioned:      ['DynamicPricing_v1'],
    dataSourcesMentioned: ['UserVault'],
    summary:              'Deploys DynamicPricing_v1 model using browsing history and location data for individualized pricing.',
  };
  assert(ctx.intent.taskType === 'Individualized Pricing', 'taskType set');
  assert(ctx.intent.modelsMentioned.includes('DynamicPricing_v1'), 'DynamicPricing_v1 detected');
  console.log('  ℹ Stage 2 mocked — real implementation ready, needs OpenAI billing');

  // ── Stage 3 ────────────────────────────────────────────────────────────────
  console.log('\nStage 3 — Research (Tavily / static fallback)');
  await research(ctx);

  assert(Array.isArray(ctx.legalFindings),                'legalFindings is array');
  assert(ctx.legalFindings.length === 2,                  'one finding per jurisdiction (CA + EU)');

  const caFinding = ctx.legalFindings.find((f) => f.jurisdiction === 'California');
  const euFinding = ctx.legalFindings.find((f) => f.jurisdiction === 'EU');

  assert(!!caFinding,                                     'California finding present');
  assert(!!euFinding,                                     'EU finding present');
  assert(caFinding?.citations?.length > 0,                'California has citations');
  assert(euFinding?.citations?.length > 0,                'EU has citations');
  assert(caFinding?.citations?.some((c) => c.includes('CCPA') || c.includes('ADMT')), 'CA citation mentions CCPA/ADMT');
  assert(euFinding?.citations?.some((c) => c.includes('AI Act') || c.includes('GDPR')), 'EU citation mentions AI Act/GDPR');

  // ── Stage 4 ────────────────────────────────────────────────────────────────
  console.log('\nStage 4 — Trace (Neo4j / static fallback)');
  await trace(ctx);

  assert(ctx.graphEvidence !== undefined,                 'graphEvidence populated');
  assert(Array.isArray(ctx.graphEvidence.pathsFound),     'pathsFound is array');
  assert(ctx.graphEvidence.pathsFound.length > 0,         'at least one lineage path found');
  assert(Array.isArray(ctx.graphEvidence.sensitiveData),  'sensitiveData is array');
  assert(ctx.graphEvidence.sensitiveData.length > 0,      'sensitive data types found');
  assert(['Critical','High','Medium','Low'].includes(ctx.graphEvidence.riskLevel), 'riskLevel is valid');
  assert(ctx.graphEvidence.pathsFound.some((p) => p.includes('California')), 'path touches California data');

  // ── Summary ────────────────────────────────────────────────────────────────
  console.log('\n══════════════════════════════════════════');
  if (failures === 0) {
    console.log('  ALL TESTS PASSED ✓');
  } else {
    console.error(`  ${failures} TEST(S) FAILED`);
    process.exit(1);
  }
  console.log('══════════════════════════════════════════\n');

  // Print a snapshot of the full context so far
  console.log('Context snapshot:');
  console.log('  pr.title:       ', ctx.pr.title);
  console.log('  jurisdictions:  ', ctx.jurisdictions.join(', '));
  console.log('  intent.taskType:', ctx.intent.taskType);
  console.log('  legalFindings:  ', ctx.legalFindings.map(f => `${f.jurisdiction}(${f.citations.length} citations)`).join(', '));
  console.log('  graphEvidence:  ', `${ctx.graphEvidence.pathsFound.length} paths | riskLevel=${ctx.graphEvidence.riskLevel} | sensitive=${ctx.graphEvidence.sensitiveData.join(',')}`);
}

run().catch((err) => {
  console.error('FATAL test error:', err);
  process.exit(1);
});
