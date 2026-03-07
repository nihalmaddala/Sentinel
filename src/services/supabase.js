'use strict';

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

// ── Client ────────────────────────────────────────────────────────────────────
// Uses service role key — bypasses RLS, server-side only.

let supabase = null;

if (config.supabase.url && config.supabase.serviceRoleKey) {
  supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false },
  });
  console.log('[supabase] Client initialised ✓');
} else {
  console.warn('[supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — persistence disabled');
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Map overallScore (0.0–1.0) → severity string for the dashboard.
 */
function scoreToSeverity(score) {
  if (score >= 0.65) return 'critical';
  if (score >= 0.4)  return 'high';
  if (score >= 0.2)  return 'medium';
  return 'low';
}

/**
 * Map verdict decision → issue status string.
 */
function decisionToStatus(decision) {
  if (decision === 'BLOCK')     return 'blocked';
  if (decision === 'ESC_HUMAN') return 'pending';
  return 'complete';
}

/**
 * Pick the primary regulation to display from jurisdiction breakdown.
 * Prefers the first BLOCK jurisdiction, falls back to first jurisdiction overall.
 */
function primaryRegulation(verdict, legalFindings) {
  // Try to extract from jurisdiction breakdown
  const blocked = (verdict.jurisdictionBreakdown || []).find(j => j.decision === 'BLOCK');
  const jur = blocked?.jurisdiction || (verdict.jurisdictionBreakdown?.[0]?.jurisdiction);

  const REGULATION_MAP = {
    California: 'CCPA',
    EU: 'EU AI Act',
    Illinois: 'BIPA',
    Texas: 'TDPSA',
    Colorado: 'CPA',
  };
  if (jur && REGULATION_MAP[jur]) return REGULATION_MAP[jur];

  // Fallback: first law name from legalFindings
  const firstLaw = legalFindings?.[0]?.laws?.[0];
  if (firstLaw) return firstLaw.split('/')[0].trim();

  return null;
}

/**
 * Build the todos JSONB array.
 * Prefers structured rolePacks from GPT-4o; falls back to regex-bucketed recommendations.
 */
function buildTodos(verdict) {
  const todos = [];
  let id = 1;
  const rp = verdict.rolePacks;

  if (rp) {
    // Use structured role pack action items from GPT-4o Pass 2
    const engTasks = [
      ...(rp.engineering?.patchGuidance   || []),
      ...(rp.engineering?.testsToAdd      || []),
    ];
    for (const task of engTasks) {
      todos.push({ id: id++, team: 'Engineering', task, status: 'pending', assignee: 'Unassigned' });
    }
    for (const task of (rp.legal?.requiredDocuments || [])) {
      todos.push({ id: id++, team: 'Legal', task, status: 'pending', assignee: 'Unassigned' });
    }
    for (const task of (rp.compliance?.checklistItems || [])) {
      todos.push({ id: id++, team: 'Compliance', task, status: 'pending', assignee: 'Unassigned' });
    }
    if (rp.leadership?.recommendedAction && rp.leadership.recommendedAction !== 'PROCEED') {
      todos.push({
        id: id++,
        team: 'Product',
        task: `${rp.leadership.recommendedAction}: ${rp.leadership.businessExposure || rp.leadership.riskSummary || ''}`,
        status: 'pending',
        assignee: 'Unassigned',
      });
    }
  }

  // Fallback: regex-bucket the top-level recommendations
  if (todos.length === 0) {
    const engRecs = (verdict.recommendations || []).filter(r =>
      /encrypt|implement|add|fix|deploy|test|code|api|data/i.test(r)
    );
    const legalRecs = (verdict.recommendations || []).filter(r =>
      /legal|counsel|ccpa|gdpr|assess|register|document|policy|consent|opt/i.test(r)
    );
    const other = (verdict.recommendations || []).filter(r =>
      !engRecs.includes(r) && !legalRecs.includes(r)
    );
    for (const task of engRecs)   todos.push({ id: id++, team: 'Engineering', task, status: 'pending', assignee: 'Unassigned' });
    for (const task of legalRecs) todos.push({ id: id++, team: 'Legal',       task, status: 'pending', assignee: 'Unassigned' });
    for (const task of other)     todos.push({ id: id++, team: 'Compliance',  task, status: 'pending', assignee: 'Unassigned' });
  }

  if (todos.length === 0 && verdict.recommendations?.length > 0) {
    todos.push({ id: 1, team: 'Engineering', task: verdict.recommendations[0], status: 'pending', assignee: 'Unassigned' });
  }

  return todos;
}

/**
 * Build the reports JSONB array — one entry per dashboard tab.
 * Prefers GPT-4o rolePacks; enriches with Neo4j lineage and legal citations.
 * Tabs: Engineering, Legal, Compliance, Product (maps to rolePacks.leadership).
 */
function buildReports(ctx) {
  const { verdict, intent, graphEvidence } = ctx;
  const reports = [];
  const rp = verdict.rolePacks;

  // ── Engineering ─────────────────────────────────────────────────────────────
  const engLines = [];
  engLines.push(`## Engineering Report`);
  engLines.push('');
  engLines.push(`**PR Intent:** ${intent?.taskType || 'Unknown task type'}`);
  if (intent?.riskIndicators?.length) {
    engLines.push(`**Risk Indicators:** ${intent.riskIndicators.join(', ')}`);
  }
  engLines.push('');
  if (graphEvidence?.pathsFound?.length) {
    engLines.push(`### Infrastructure Lineage Paths`);
    engLines.push('');
    graphEvidence.pathsFound.forEach(p => engLines.push(`- \`${p}\``));
    engLines.push('');
  }
  if (graphEvidence?.sensitiveData?.length) {
    engLines.push(`**Sensitive Data Confirmed:** ${graphEvidence.sensitiveData.join(', ')}`);
    engLines.push('');
  }
  if (rp?.engineering) {
    const e = rp.engineering;
    if (e.affectedFiles?.length) {
      engLines.push(`### Affected Files`);
      engLines.push('');
      e.affectedFiles.forEach(f => engLines.push(`- \`${f}\``));
      engLines.push('');
    }
    if (e.patchGuidance?.length) {
      engLines.push(`### Patch Guidance`);
      engLines.push('');
      e.patchGuidance.forEach((g, i) => engLines.push(`${i + 1}. ${g}`));
      engLines.push('');
    }
    if (e.testsToAdd?.length) {
      engLines.push(`### Tests Required`);
      engLines.push('');
      e.testsToAdd.forEach((t, i) => engLines.push(`${i + 1}. ${t}`));
      engLines.push('');
    }
    if (e.rolloutPlan) {
      engLines.push(`### Rollout Plan`);
      engLines.push('');
      engLines.push(e.rolloutPlan);
      engLines.push('');
    }
  }
  reports.push({ team: 'Engineering', report: engLines.join('\n') });

  // ── Legal ────────────────────────────────────────────────────────────────────
  const legalLines = [];
  legalLines.push(`## Legal Report`);
  legalLines.push('');
  if (verdict.jurisdictionBreakdown?.length) {
    legalLines.push('### Jurisdiction Analysis');
    legalLines.push('');
    legalLines.push('| Jurisdiction | Decision | Reason |');
    legalLines.push('|---|---|---|');
    verdict.jurisdictionBreakdown.forEach(j => {
      const label = j.decision === 'BLOCK' ? 'BLOCK' : j.decision === 'ALLOW' ? 'ALLOW' : 'ESC_HUMAN';
      legalLines.push(`| ${j.jurisdiction} | ${label} | ${j.reason} |`);
    });
    legalLines.push('');
  }
  if (verdict.citations?.length) {
    legalLines.push('### Applicable Legal Citations');
    legalLines.push('');
    verdict.citations.forEach(c => {
      const cite = typeof c === 'string' ? c : `**${c.law || c.jurisdiction || ''}** -- ${c.excerpt || c.snippet || ''}`;
      legalLines.push(`- ${cite}`);
    });
    legalLines.push('');
  }
  if (rp?.legal) {
    const l = rp.legal;
    if (l.applicableLawSections?.length) {
      legalLines.push(`### Applicable Law Sections`);
      legalLines.push('');
      l.applicableLawSections.forEach(s => legalLines.push(`- ${s}`));
      legalLines.push('');
    }
    if (l.requiredDocuments?.length) {
      legalLines.push(`### Required Documents`);
      legalLines.push('');
      l.requiredDocuments.forEach((d, i) => legalLines.push(`${i + 1}. ${d}`));
      legalLines.push('');
    }
    if (l.signOffNeeds?.length) {
      legalLines.push(`### Sign-off Required`);
      legalLines.push('');
      l.signOffNeeds.forEach(s => legalLines.push(`- ${s}`));
      legalLines.push('');
    }
  }
  reports.push({ team: 'Legal', report: legalLines.join('\n') });

  // ── Compliance ───────────────────────────────────────────────────────────────
  const complianceLines = [];
  complianceLines.push(`## Compliance Report`);
  complianceLines.push('');
  if (rp?.compliance) {
    const c = rp.compliance;
    if (c.checklistItems?.length) {
      complianceLines.push('### Compliance Checklist');
      complianceLines.push('');
      c.checklistItems.forEach((item, i) => complianceLines.push(`${i + 1}. ${item}`));
      complianceLines.push('');
    }
    if (c.auditArtifacts?.length) {
      complianceLines.push(`### Audit Artifacts to Retain`);
      complianceLines.push('');
      c.auditArtifacts.forEach(a => complianceLines.push(`- ${a}`));
      complianceLines.push('');
    }
    if (c.retentionNotes) {
      complianceLines.push(`### Retention & Logging`);
      complianceLines.push('');
      complianceLines.push(c.retentionNotes);
      complianceLines.push('');
    }
    if (c.dpiaRequired) {
      complianceLines.push('> **DPIA Required** -- A Data Protection Impact Assessment must be completed before deployment.');
      complianceLines.push('');
    }
  } else {
    complianceLines.push('No structured compliance report available for this issue.');
    complianceLines.push('');
    complianceLines.push('Review the Legal and Engineering reports for actionable items.');
    if (verdict.missingFacts?.length) {
      complianceLines.push('');
      complianceLines.push(`### Missing Facts`);
      complianceLines.push('');
      verdict.missingFacts.forEach(f => complianceLines.push(`- ${f}`));
      complianceLines.push('');
    }
  }
  reports.push({ team: 'Compliance', report: complianceLines.join('\n') });

  // ── Product / Leadership (mapped to the "Product" tab in the dashboard) ──────
  const productLines = [];
  productLines.push(`## Leadership Briefing`);
  productLines.push('');
  if (rp?.leadership) {
    const ldr = rp.leadership;
    if (ldr.riskSummary) {
      productLines.push(`### Risk Summary`);
      productLines.push('');
      productLines.push(ldr.riskSummary);
      productLines.push('');
    }
    if (ldr.businessExposure) {
      productLines.push(`### Business Exposure`);
      productLines.push('');
      productLines.push(ldr.businessExposure);
      productLines.push('');
    }
    if (ldr.recommendedAction) {
      productLines.push(`**Recommended Action:** ${ldr.recommendedAction}`);
    }
    if (ldr.estimatedResolutionTimeline) {
      productLines.push(`**Estimated Resolution:** ${ldr.estimatedResolutionTimeline}`);
    }
    productLines.push('');
    if (ldr.regulatoryContext) {
      productLines.push(`### Regulatory Context`);
      productLines.push('');
      productLines.push(ldr.regulatoryContext);
      productLines.push('');
    }
  } else {
    productLines.push('No leadership briefing available for this issue.');
    productLines.push('');
    productLines.push(`| Metric | Value |`);
    productLines.push(`|---|---|`);
    productLines.push(`| Overall Risk Score | ${((verdict.overallScore || 0) * 100).toFixed(0)}% |`);
    productLines.push(`| Decision | ${verdict.decision} |`);
    productLines.push('');
    if (verdict.confidenceRationale) {
      productLines.push(`**Confidence Rationale:** ${verdict.confidenceRationale}`);
      productLines.push('');
    }
  }
  reports.push({ team: 'Product', report: productLines.join('\n') });

  return reports;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Persist the raw pipeline verdict to the `verdicts` table.
 * Returns the inserted row id, or null if Supabase is not configured.
 */
async function saveVerdict(ctx) {
  if (!supabase) return null;

  const { pr, jurisdictions, intent, graphEvidence, verdict, enforcement } = ctx;

  const row = {
    pr_number:             pr.number,
    pr_title:              pr.title,
    pr_user:               pr.user || null,
    repo:                  pr.repo,
    owner:                 pr.owner,
    sha:                   pr.sha || null,
    jurisdictions:         jurisdictions || [],
    task_type:             intent?.taskType || null,
    risk_indicators:       intent?.riskIndicators || [],
    models_mentioned:      intent?.modelsMentioned || [],
    intent_summary:        intent?.summary || null,
    decision:              verdict.decision,
    overall_score:         verdict.overallScore,
    legal_risk:            verdict.legalRisk,
    arch_exposure:         verdict.architecturalExposure,
    reasoning:             verdict.reasoning,
    citations:             verdict.citations || [],
    recommendations:       verdict.recommendations || [],
    jurisdiction_breakdown: verdict.jurisdictionBreakdown || [],
    graph_paths:           graphEvidence?.pathsFound || [],
    sensitive_data:        graphEvidence?.sensitiveData || [],
    graph_risk_level:      graphEvidence?.riskLevel || null,
    verdict_source:        verdict._source || null,
    enforced_at:           enforcement?.enforcedAt || new Date().toISOString(),
  };

  const { data, error } = await supabase.from('verdicts').insert(row).select('id').single();
  if (error) {
    console.error('[supabase] Failed to save verdict:', error.message);
    return null;
  }

  console.log(`[supabase] Verdict saved: ${data.id}`);
  return data.id;
}

/**
 * Persist a dashboard-ready issue to the `issues` table.
 * Only called for BLOCK and ESC_HUMAN decisions.
 * Returns the inserted issue_id string (e.g. "ARG-7"), or null on failure.
 */
async function saveIssue(ctx, verdictId) {
  if (!supabase) return null;

  const { pr, verdict, legalFindings } = ctx;

  // Generate sequential issue ID from current row count
  const { count } = await supabase
    .from('issues')
    .select('*', { count: 'exact', head: true });

  const issueId = `ARG-${(count || 0) + 1}`;

  const row = {
    verdict_id:  verdictId,
    issue_id:    issueId,
    title:       pr.title,
    description: verdict.reasoning,
    severity:    scoreToSeverity(verdict.overallScore),
    status:      decisionToStatus(verdict.decision),
    regulation:  primaryRegulation(verdict, legalFindings),
    source_file: pr.diff?.split('\n').find(l => l.startsWith('+++'))?.replace('+++ b/', '') || null,
    pr_number:   String(pr.number),
    repository:  pr.repo,
    todos:       buildTodos(verdict),
    reports:     buildReports(ctx),
  };

  const { data, error } = await supabase.from('issues').insert(row).select('issue_id').single();
  if (error) {
    console.error('[supabase] Failed to save issue:', error.message);
    return null;
  }

  console.log(`[supabase] Issue saved: ${data.issue_id}`);
  return data.issue_id;
}

module.exports = { saveVerdict, saveIssue };
