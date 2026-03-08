'use strict';

const { createHmac, timingSafeEqual } = require('crypto');
const { Router } = require('express');
const config = require('../config');
const { getInstallationToken } = require('./auth');
const { createPendingCheck, updateCheck, buildAnnotations } = require('./checks');
const { postAuditReport } = require('./comments');
const { fetchPRCommits } = require('./commits');
const { fetchPRDiff } = require('./diff');
const { saveScan } = require('../services/supabase');

// Pipeline orchestrator — wired in Increment 3.
// Gracefully falls back to a stub if not yet implemented.
let runPipeline;
try {
  runPipeline = require('../pipeline/index');
} catch {
  runPipeline = null;
}

// ── Signature verification ────────────────────────────────────────────────────

/**
 * Verify the GitHub HMAC-SHA256 webhook signature.
 * Uses timingSafeEqual to prevent timing attacks.
 *
 * @param {Buffer} rawBody  Raw request body (from express.raw)
 * @param {string} signature  Value of X-Hub-Signature-256 header
 * @returns {boolean}
 */
function verifySignature(rawBody, signature) {
  if (!signature || !signature.startsWith('sha256=')) return false;
  const expected = Buffer.from(signature);
  const computed = Buffer.from(
    'sha256=' + createHmac('sha256', config.github.webhookSecret).update(rawBody).digest('hex')
  );
  if (expected.length !== computed.length) return false;
  return timingSafeEqual(expected, computed);
}

// ── Pipeline dispatch ─────────────────────────────────────────────────────────

/**
 * Run the full 6-stage pipeline for a PR event.
 * Responds immediately (202) and processes asynchronously.
 *
 * @param {object} payload  Parsed webhook JSON
 */
async function processPullRequest(payload) {
  const { pull_request: pr, repository, installation } = payload;
  const owner = repository.owner.login;
  const repo = repository.name;
  const sha = pr.head.sha;
  const prNumber = pr.number;
  const installationId = installation.id;

  console.log(`\n[webhook] ── Processing PR #${prNumber} (${owner}/${repo} @ ${sha.slice(0, 8)})`);

  let token, checkRunId;

  try {
    token = await getInstallationToken(installationId);
    checkRunId = await createPendingCheck(token, owner, repo, sha);
  } catch (err) {
    console.error('[webhook] Failed during pre-pipeline setup:', err.message);
    return;
  }

  // Fetch the actual code diff and attach it to the payload before
  // running the pipeline — Stage 1 will store it in ctx.pr.diff
  try {
    const { summary, files } = await fetchPRDiff(token, owner, repo, prNumber);
    payload._diff = summary;
    payload._files = files || [];
  } catch (err) {
    // Non-fatal — pipeline degrades gracefully to metadata-only analysis
    console.warn('[webhook] Could not fetch PR diff (continuing without it):', err.message);
    payload._diff = null;
    payload._files = [];
  }

  try {
    payload._commits = await fetchPRCommits(token, owner, repo, prNumber);
  } catch (err) {
    console.warn('[webhook] Could not fetch PR commits (continuing without them):', err.message);
    payload._commits = [];
  }

  try {
    let ctx;

    if (typeof runPipeline === 'function') {
      // Sentinel pipeline — Intercept → Injection Scan → Enforce
      ctx = await runPipeline(payload);
    } else {
      // Increment 2 stub: pipeline not yet implemented
      console.warn('[webhook] Pipeline not yet wired — using stub verdict');
      ctx = {
        pr: { id: pr.id, title: pr.title, number: prNumber, sha, repo, owner },
        jurisdictions: [],
        verdict: {
          decision: 'MERGE',
          overallScore: 0,
          legalRisk: 0,
          architecturalExposure: 0,
          reasoning: 'Pipeline stub — no analysis performed yet.',
          citations: [],
          recommendations: [],
        },
      };
    }

    // Build inline code-line annotations for the PR diff view (BLOCK / ESC_HUMAN only).
    // Pass ctx.pr.files (already fetched in the diff step) to avoid a redundant API call.
    const annotations = await buildAnnotations(token, owner, repo, prNumber, ctx.verdict, ctx.pr?.files);

    await updateCheck(token, owner, repo, checkRunId, ctx.verdict, annotations);

    // Post the full audit report comment only on BLOCK or ESC_HUMAN
    if (ctx.verdict.decision !== 'MERGE') {
      await postAuditReport(token, owner, repo, prNumber, ctx);
    }

    // Persist to Supabase — non-fatal if it fails
    saveScan(ctx).catch((err) =>
      console.error('[webhook] saveScan failed (non-fatal):', err.message)
    );

    console.log(`[webhook] ── PR #${prNumber} resolved: ${ctx.verdict.decision}\n`);
  } catch (err) {
    console.error('[webhook] Pipeline error:', err.message);

    // Fail the check so the PR is never left in "pending" limbo
    if (token && checkRunId) {
      await updateCheck(token, owner, repo, checkRunId, {
        decision: 'ESC_HUMAN',
        overallScore: 0,
        legalRisk: 0,
        architecturalExposure: 0,
        reasoning: `Sentinel encountered an internal error: ${err.message}`,
        citations: [],
        recommendations: ['Contact the Sentinel team to investigate the pipeline failure.'],
      }).catch((e) => console.error('[webhook] Failed to update check after error:', e.message));
    }
  }
}

// ── Express router ────────────────────────────────────────────────────────────

const router = Router();

router.post('/', (req, res) => {
  const rawBody = req.body; // Buffer from express.raw()
  const signature = req.headers['x-hub-signature-256'];
  const event = req.headers['x-github-event'];

  // 1. Verify signature
  if (!verifySignature(rawBody, signature)) {
    console.warn('[webhook] Invalid signature — rejected');
    return res.status(401).json({ error: 'Invalid webhook signature' });
  }

  // 2. Parse body
  let payload;
  try {
    payload = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'Invalid JSON payload' });
  }

  // 3. Acknowledge immediately — GitHub expects a fast 2xx response
  res.status(202).json({ received: true });

  // 4. Route by event type
  if (event === 'pull_request' && (payload.action === 'opened' || payload.action === 'synchronize')) {
    processPullRequest(payload).catch((err) =>
      console.error('[webhook] Unhandled processPullRequest error:', err.message)
    );
  } else {
    console.log(`[webhook] Ignored event: ${event} / action: ${payload.action}`);
  }
});

module.exports = { router, verifySignature };
