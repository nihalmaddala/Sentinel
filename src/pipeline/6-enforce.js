'use strict';

// Stage 6: Map verdict → MERGE / BLOCK / ESC_HUMAN, call Checks API

/**
 * Stage 6 — Enforce
 *
 * This stage is intentionally thin. The actual GitHub API calls
 * (createPendingCheck, updateCheck, postAuditReport) are made in
 * src/github/webhook.js which wraps the full pipeline invocation.
 *
 * What this stage does:
 * - Validates verdict shape
 * - Enriches ctx.enforcement with action metadata logged to the console
 * - Provides the single point where the final MERGE/BLOCK/ESC_HUMAN
 *   decision is confirmed so it's visible in pipeline logs
 *
 * The webhook.js layer reads ctx.verdict.decision after this stage
 * and calls updateCheck() + postAuditReport() accordingly.
 */

const DECISION_LABELS = {
  MERGE:      'MERGE ALLOWED',
  BLOCK:      'MERGE BLOCKED',
  ESC_HUMAN:  'ESCALATED TO HUMAN REVIEW',
};

/**
 * @param {object} ctx  Pipeline context (must have ctx.verdict from Stage 5)
 * @returns {object}    ctx with ctx.enforcement populated
 */
function enforce(ctx) {
  console.log('[enforce] Stage 6 — Enforce starting…');

  const { verdict, pr } = ctx;
  if (!verdict) throw new Error('[enforce] ctx.verdict missing — run Stage 5 first');

  const label = DECISION_LABELS[verdict.decision] || `UNKNOWN (${verdict.decision})`;
  const score = `${((verdict.overallScore || 0) * 100).toFixed(0)}%`;

  console.log(`\n╔══════════════════════════════════════╗`);
  console.log(`║  SENTINEL COMPLIANCE VERDICT          ║`);
  console.log(`║  PR #${String(pr?.number || '?').padEnd(32)}║`);
  console.log(`║  ${label.padEnd(37)}║`);
  console.log(`║  Risk Score: ${score.padEnd(26)}║`);
  console.log(`║  Source: ${(verdict._source || 'unknown').padEnd(29)}║`);
  console.log(`╚══════════════════════════════════════╝\n`);

  if (verdict.jurisdictionBreakdown?.length > 0) {
    console.log('[enforce] Per-jurisdiction breakdown:');
    for (const jb of verdict.jurisdictionBreakdown) {
      const icon = jb.decision === 'BLOCK' ? '[BLOCK]' : jb.decision === 'ALLOW' ? '[ALLOW]' : '[ESC_HUMAN]';
      console.log(`  ${icon} ${jb.jurisdiction}: ${jb.decision} — ${jb.reason}`);
    }
  }

  if (verdict.recommendations?.length > 0) {
    console.log('\n[enforce] Recommendations to unblock:');
    verdict.recommendations.forEach((r, i) => console.log(`  ${i + 1}. ${r}`));
  }

  ctx.enforcement = {
    decision:   verdict.decision,
    score:      verdict.overallScore,
    label,
    enforcedAt: new Date().toISOString(),
  };

  console.log('\n[enforce] Stage 6 complete ✓');
  return ctx;
}

module.exports = { enforce };
