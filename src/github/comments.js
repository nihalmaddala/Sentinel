'use strict';

const GITHUB_API = 'https://api.github.com';
const { renderInjectionReport } = require('../attacker/injection-report');

const DECISION_BADGE = {
  BLOCK:     'BLOCKED',
  ESC_HUMAN: 'NEEDS REVIEW',
  MERGE:     'APPROVED',
};

const DECISION_ICON = { BLOCK: 'BLOCK', ESC_HUMAN: 'REVIEW', MERGE: 'ALLOW' };

// ── Helpers ───────────────────────────────────────────────────────────────────

function pct(n) { return `${((n || 0) * 100).toFixed(0)}%`; }

function confBar(confidence) {
  const p = Math.round((confidence || 0) * 100);
  if (p >= 90) return `${p}% — very high`;
  if (p >= 70) return `${p}% — sufficient to block`;
  if (p >= 50) return `${p}% — escalate`;
  return `${p}% — insufficient to block`;
}

/** Format a citation object (new structured format or legacy string) as a markdown line. */
function formatCitation(c) {
  if (typeof c === 'string') return c.slice(0, 280);
  const qual = c.source_quality === 'AUTHORITATIVE' ? '**[AUTH]**' : '[REF]';
  const law  = c.law || c.id || '';
  const excerpt = c.excerpt ? ` — _"${c.excerpt}"_` : '';
  const link = c.url ? ` [(source)](${c.url})` : '';
  return `${qual} ${law}${excerpt}${link}`.trim();
}

/**
 * Deduplicate and group lineage paths by their target database.
 * Input:  ["ModelA → DB [CA] → Email (PII)", ...]
 * Output: { "DB [CA]": ["Email (PII)", ...] }
 */
function groupLineagePaths(paths) {
  const groups = {};
  for (const path of (paths || [])) {
    const match = path.match(/→\s*([^→]+\[[^\]]+\])\s*→\s*(.+)$/);
    if (match) {
      const db   = match[1].trim();
      const data = match[2].trim();
      if (!groups[db]) groups[db] = new Set();
      groups[db].add(data);
    } else {
      if (!groups['Other']) groups['Other'] = new Set();
      groups['Other'].add(path);
    }
  }
  return groups;
}

// ── Section renderers ─────────────────────────────────────────────────────────

/**
 * SECTION 1 — PR info block (visible on the GitHub PR page without expanding).
 * Covers: decision, scores, reasoning, intent, violating code.
 */
function renderPRInfo(verdict, intent, graphEvidence) {
  const badge    = DECISION_BADGE[verdict.decision] || verdict.decision;
  const riskLvl  = graphEvidence?.riskLevel || 'Unknown';
  const summary  = verdict.prSummary || {};
  const lines    = [];

  lines.push(`## Argus Compliance Report — ${badge}`, '');

  // Score table
  lines.push(
    '| Metric | Value |',
    '|--------|-------|',
    `| **Decision** | ${badge} |`,
    `| **Overall Risk** | ${pct(verdict.overallScore)} |`,
    `| **Legal Risk** | ${pct(verdict.legalRisk)} |`,
    `| **Architectural Exposure** | ${pct(verdict.architecturalExposure)} |`,
    `| **Confidence** | ${confBar(verdict.confidence)} |`,
    `| **Task Type** | ${intent?.taskType || 'Unknown'} |`,
    `| **Infrastructure Risk** | ${riskLvl} |`,
    '',
  );

  // Intent — what the engineer was trying to do
  if (summary.intent) {
    lines.push(`> **What this PR does:** ${summary.intent}`, '');
  }

  // Main reasoning
  if (summary.reasoning || verdict.reasoning) {
    lines.push('### Why', '', `> ${summary.reasoning || verdict.reasoning}`, '');
  }

  // Confidence + missing facts
  if (verdict.confidence !== undefined) {
    lines.push(`**Confidence:** ${confBar(verdict.confidence)}`);
    if (verdict.confidenceRationale) lines.push(`_${verdict.confidenceRationale}_`);
    if (verdict._confidenceDemoted) {
      lines.push('', '> **Note:** This PR would have been BLOCKED but confidence was below the 70% threshold — human review required.');
    }
    if (verdict.missingFacts?.length > 0) {
      lines.push('', '**Evidence needed to raise confidence:**');
      verdict.missingFacts.forEach((f) => lines.push(`- ${f}`));
    }
    lines.push('');
  }

  // Violating code — specific lines that caused the block
  if (verdict.violatingCode?.length > 0) {
    lines.push('### Code That Triggered This Decision', '');
    for (const v of verdict.violatingCode) {
      const sev = v.severity === 'HIGH' ? '[HIGH]' : v.severity === 'MEDIUM' ? '[MEDIUM]' : '[LOW]';
      lines.push(`**${sev} \`${v.file}\` lines ${v.lines}** — ${v.regulation || ''}`);
      lines.push('```');
      lines.push(v.snippet || '');
      lines.push('```');
      lines.push(`> ${v.issue}`, '');
    }
  }

  // Jurisdiction breakdown table
  if (verdict.jurisdictionBreakdown?.length > 0) {
    lines.push('### Jurisdiction Breakdown', '');
    lines.push('| Jurisdiction | Decision | Reason |');
    lines.push('|---|---|---|');
    for (const j of verdict.jurisdictionBreakdown) {
      const label  = DECISION_ICON[j.decision] || j.decision;
      const reason = (j.reason || '').replace(/\|/g, '/').slice(0, 140);
      lines.push(`| **${j.jurisdiction}** | ${label} | ${reason} |`);
    }
    lines.push('');
  }

  // Top authoritative citations
  const authCitations = (verdict.citations || []).filter((c) =>
    (typeof c === 'object' ? c.source_quality : c)?.toUpperCase?.() === 'AUTHORITATIVE' ||
    /AUTHORITATIVE/i.test(typeof c === 'string' ? c : '')
  ).slice(0, 4);
  if (authCitations.length > 0) {
    lines.push('### Key Legal Citations', '');
    authCitations.forEach((c) => lines.push(`- ${formatCitation(c)}`));
    lines.push('');
  }

  // Quick action list
  if (verdict.recommendations?.length > 0) {
    lines.push('### Required Actions', '');
    verdict.recommendations.forEach((r) => lines.push(`- [ ] ${r}`));
    lines.push('');
  }

  return lines;
}

/**
 * SECTION 2 — Engineering role pack.
 * Specific files, code fixes, tests, rollout plan.
 */
function renderEngineering(rp, violatingCode) {
  if (!rp) return [];
  const lines = [];

  lines.push('<details>');
  lines.push('<summary><strong>Engineering — Code Changes Required</strong></summary>');
  lines.push('');

  // Affected files
  if (rp.affectedFiles?.length > 0) {
    lines.push('**Affected Files:**');
    rp.affectedFiles.forEach((f) => lines.push(`- \`${f}\``));
    lines.push('');
  }

  // Violating code cross-reference
  if (violatingCode?.length > 0) {
    lines.push('**Violations to Fix:**');
    for (const v of violatingCode) {
      lines.push(`- **\`${v.file}:${v.lines}\`** — ${v.issue}`);
      if (v.regulation) lines.push(`  _Regulation: ${v.regulation}_`);
    }
    lines.push('');
  }

  if (rp.patchGuidance?.length > 0) {
    lines.push('**Specific Code Fixes:**');
    rp.patchGuidance.forEach((g) => lines.push(`- [ ] ${g}`));
    lines.push('');
  }

  if (rp.testsToAdd?.length > 0) {
    lines.push('**Tests to Add Before Merge:**');
    rp.testsToAdd.forEach((t) => lines.push(`- [ ] ${t}`));
    lines.push('');
  }

  if (rp.rolloutPlan) {
    lines.push(`**Rollout Plan:** ${rp.rolloutPlan}`);
    lines.push('');
  }

  lines.push('</details>');
  return lines;
}

/**
 * SECTION 3 — Compliance / Audit role pack.
 * Checklist, artifacts to retain, DPIA requirement.
 */
function renderCompliance(rp) {
  if (!rp) return [];
  const lines = [];

  lines.push('<details>');
  lines.push('<summary><strong>Compliance & Audit</strong></summary>');
  lines.push('');

  if (rp.dpiaRequired) {
    lines.push('> **DPIA Required** — A Data Protection Impact Assessment must be completed before deployment.', '');
  }

  if (rp.checklistItems?.length > 0) {
    lines.push('**Compliance Checklist:**');
    rp.checklistItems.forEach((item) => lines.push(`- [ ] ${item}`));
    lines.push('');
  }

  if (rp.auditArtifacts?.length > 0) {
    lines.push('**Audit Artifacts to Retain:**');
    rp.auditArtifacts.forEach((a) => lines.push(`- ${a}`));
    lines.push('');
  }

  if (rp.retentionNotes) {
    lines.push(`**Retention & Logging:** ${rp.retentionNotes}`, '');
  }

  lines.push('</details>');
  return lines;
}

/**
 * SECTION 4 — Legal role pack.
 * Applicable law sections, required documents, sign-offs.
 */
function renderLegal(rp, legalFindings) {
  if (!rp) return [];
  const lines = [];

  lines.push('<details>');
  lines.push('<summary><strong>Legal — Requirements & Sign-offs</strong></summary>');
  lines.push('');

  if (rp.applicableLawSections?.length > 0) {
    lines.push('**Applicable Laws & Obligations:**');
    rp.applicableLawSections.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }

  // Full citation detail from legal findings (authoritative only)
  const authFindings = (legalFindings || []).flatMap((f) =>
    (f.citations || [])
      .filter((c) => c.source_quality === 'AUTHORITATIVE')
      .slice(0, 2)
      .map((c) => ({ ...c, jurisdiction: f.jurisdiction }))
  ).slice(0, 6);

  if (authFindings.length > 0) {
    lines.push('**Authoritative Citations:**');
    for (const c of authFindings) {
      const excerpt = c.excerpt ? ` — _"${c.excerpt}"_` : (c.snippet ? ` — _"${c.snippet.slice(0, 80)}…"_` : '');
      const link = c.url ? ` [(source)](${c.url})` : '';
      lines.push(`- [${c.jurisdiction}] ${c.law || c.id}${excerpt}${link}`);
    }
    lines.push('');
  }

  if (rp.requiredDocuments?.length > 0) {
    lines.push('**Documents Required Before Merge:**');
    rp.requiredDocuments.forEach((d) => lines.push(`- [ ] ${d}`));
    lines.push('');
  }

  if (rp.signOffNeeds?.length > 0) {
    lines.push('**Sign-off Required From:**');
    rp.signOffNeeds.forEach((s) => lines.push(`- ${s}`));
    lines.push('');
  }

  lines.push('</details>');
  return lines;
}

/**
 * SECTION 5 — Leadership role pack.
 * Business-plain risk summary, exposure, recommended action, timeline.
 */
function renderLeadership(rp) {
  if (!rp) return [];
  const lines = [];

  lines.push('<details>');
  lines.push('<summary><strong>Leadership — Business Risk Summary</strong></summary>');
  lines.push('');

  if (rp.riskSummary) {
    lines.push(`**Risk Summary:** ${rp.riskSummary}`, '');
  }

  if (rp.businessExposure) {
    lines.push(`**Business Exposure:** ${rp.businessExposure}`, '');
  }

  if (rp.regulatoryContext) {
    lines.push(`**Why This Regulation Matters:** ${rp.regulatoryContext}`, '');
  }

  const actionLabel = rp.recommendedAction === 'BLOCK' ? 'BLOCK' : rp.recommendedAction === 'REVIEW' ? 'REVIEW' : 'PROCEED';
  if (rp.recommendedAction) {
    lines.push(`**Recommended Action:** ${actionLabel}`);
  }

  if (rp.estimatedResolutionTimeline) {
    lines.push(`**Estimated Resolution:** ${rp.estimatedResolutionTimeline}`);
  }

  lines.push('');
  lines.push('</details>');
  return lines;
}

// ── Infrastructure trace (shared between PR info and details) ─────────────────

function renderTrace(graphEvidence) {
  if (!graphEvidence?.pathsFound?.length) return [];
  const lines = [];
  const grouped = groupLineagePaths(graphEvidence.pathsFound);
  lines.push('<details>');
  lines.push(`<summary><strong>Infrastructure Lineage — ${graphEvidence.riskLevel || 'Unknown'} Risk</strong></summary>`);
  lines.push('');
  lines.push('| Database | Sensitive Data Exposed |');
  lines.push('|----------|----------------------|');
  for (const [db, dataSet] of Object.entries(grouped)) {
    lines.push(`| \`${db}\` | ${[...dataSet].join(', ')} |`);
  }
  lines.push('');
  lines.push('</details>');
  return lines;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Format the verdict into a structured markdown audit report and post it
 * as a PR comment. Called on BLOCK or ESC_HUMAN decisions.
 *
 * Structure:
 *   1. PR Info (decision, scores, reasoning, violating code) — always visible
 *   2. Engineering — code fixes, tests, rollout            — collapsible
 *   3. Compliance & Audit — checklist, artifacts, DPIA     — collapsible
 *   4. Legal — law sections, required docs, sign-offs      — collapsible
 *   5. Leadership — business risk summary                  — collapsible
 *
 * @param {string} token       Installation access token
 * @param {string} owner       Repo owner login
 * @param {string} repo        Repo name
 * @param {number} prNumber    Pull request number
 * @param {object} ctx         Full pipeline context object
 */
async function postAuditReport(token, owner, repo, prNumber, ctx) {
  const { verdict, intent, legalFindings, graphEvidence } = ctx;
  const rp = verdict.rolePacks || {};

  // Build the structured legal findings for the legal section
  const structuredCitations = (legalFindings || []).flatMap((f) =>
    (f.citations || []).slice(0, 3).map((c, i) => {
      if (typeof c === 'object') return { ...c, jurisdiction: f.jurisdiction };
      const isAuth = /\[AUTHORITATIVE/i.test(c);
      return {
        id: `cit_${f.jurisdiction.toLowerCase().replace(/[^a-z]/g, '_')}_${i + 1}`,
        jurisdiction: f.jurisdiction,
        source_quality: isAuth ? 'AUTHORITATIVE' : 'REFERENCE',
        snippet: c.replace(/^\[[^\]]+\]\s*/i, '').replace(/https?:\/\/[^\s]+/g, '').trim().slice(0, 160),
        url: (c.match(/https?:\/\/[^\s,)]+/) || [])[0] || null,
      };
    })
  );

  // Group structured citations by jurisdiction so renderLegal can read f.jurisdiction correctly.
  const citationsByJurisdiction = structuredCitations.length > 0
    ? Object.values(
        structuredCitations.reduce((acc, c) => {
          const j = c.jurisdiction;
          if (!acc[j]) acc[j] = { jurisdiction: j, citations: [] };
          acc[j].citations.push(c);
          return acc;
        }, {})
      )
    : legalFindings;

  const sections = [
    ...renderPRInfo(verdict, intent, graphEvidence),
    '',
    ...renderTrace(graphEvidence),
    '',
    ...renderEngineering(rp.engineering, verdict.violatingCode),
    '',
    ...renderCompliance(rp.compliance),
    '',
    ...renderLegal(rp.legal, citationsByJurisdiction),
    '',
    ...renderLeadership(rp.leadership),
    '',
    // ── Injection Scan Report ──────────────────────────────────────────────
    renderInjectionReport(ctx?.injectionReport),
    '',
    '---',
    '*[Argus](https://github.com/apps/argus-compliance) · Autonomous Compliance Gatekeeper · Security Scanner*',
  ];

  const body = sections.join('\n');

  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Argus-Compliance-Bot/1.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ body }),
    }
  );

  if (!response.ok) {
    const errBody = await response.text();
    throw new Error(`[comments] postAuditReport failed (${response.status}): ${errBody}`);
  }

  const data = await response.json();
  console.log(`[comments] Audit report posted — comment id: ${data.id}, url: ${data.html_url}`);
  return data.html_url;
}

module.exports = { postAuditReport };
