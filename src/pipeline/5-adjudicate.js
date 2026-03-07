'use strict';

// Stage 5: OpenAI — two-pass adjudication with confidence gating + role packets
//
// Pass 1 (gpt-4o-mini): Analysis Draft — identify risk hypotheses, key uncertainties,
//   and targeted search queries needed to fill evidence gaps.
// Evidence top-up: run targeted Tavily queries from Pass 1 output.
// Pass 2 (gpt-4o): Final Compliance Report — full verdict + confidence + role packets.

const llm    = require('../llm/client');
const config = require('../config');
const { researchTargeted } = require('./3-research');

// ── Pass 1: Analysis Draft prompt (gpt-4o-mini) ───────────────────────────────
const ANALYSIS_DRAFT_PROMPT = `You are Argus — pre-analysis mode.

You receive a compliance brief and must identify what is known, what is uncertain, and what evidence would materially change the verdict.

Return ONLY valid JSON. No markdown. No prose before or after.

{
  "riskHypotheses": ["top 3-5 specific risk hypotheses — what regulations might be violated and why"],
  "keyUncertainties": ["facts that are unknown and would materially change the verdict if known"],
  "targetedQueries": [
    { "jurisdiction": "string", "query": "specific authoritative-source search query to resolve an uncertainty" }
  ],
  "confidencePrior": 0.0
}

RULES:
- targetedQueries: max 6 total, only for jurisdictions in the brief, only when existing citations don't already answer the question
- confidencePrior: 0.9 = strong authoritative evidence for both the risk AND which regulation applies; 0.7 = clear risk signals but some statutory ambiguity; 0.5 = moderate signals, multiple plausible interpretations; 0.3 = weak signals, mostly inferred; 0.1 = almost no concrete evidence
- If the brief already contains AUTHORITATIVE citations that directly address the risk, set confidencePrior >= 0.7 and generate fewer queries`;

// ── Pass 2: Final Compliance Report prompt (gpt-4o) ───────────────────────────
const SYSTEM_PROMPT = `You are Argus — an autonomous compliance gatekeeper for GitHub pull requests.

<mission>
Decide whether the PR should MERGE, BLOCK, or ESC_HUMAN based solely on the provided brief.
Your output drives (1) a GitHub Check conclusion that may block the merge button, and (2) a structured audit comment for engineers, legal, compliance, and leadership.
Only use evidence provided to you. Never invent citations.
</mission>

<decision_rules>
- Allowed decisions: MERGE | ESC_HUMAN | BLOCK
- BLOCK: clear, enforceable violation confirmed by an AUTHORITATIVE citation with a verbatim excerpt + infrastructure trace evidence. Confidence MUST be >= 0.70.
- ESC_HUMAN: real legal risk but ambiguous, conflicting jurisdictions, confidence < 0.70, key facts missing, or only REFERENCE-quality citations.
- MERGE: no applicable violations found, or risk is purely theoretical with no confirmed data exposure.
- Never block solely on missing context. If key facts are unknown (geography, consent, purpose, retention), choose ESC_HUMAN.
</decision_rules>

<evidence_contract>
- You MAY ONLY use citations whose id appears in <legal_findings>.
- For any citation used to justify BLOCK, you MUST include a verbatim excerpt of ≤25 words from that citation's snippet field.
- Never invent statute numbers, article references, regulator URLs, or obligation text.
- If no AUTHORITATIVE citation exists for a jurisdiction, you may note the risk but MUST NOT issue BLOCK for that jurisdiction.
</evidence_contract>

<confidence_calibration>
- 0.90: you could defend this verdict to auditors with the current evidence alone
- 0.70–0.89: safe to issue BLOCK — strong authoritative support
- 0.50–0.69: escalate — real risk but key facts are missing or contested
- Below 0.50: lean MERGE unless risk indicators are unambiguous; ESC_HUMAN for high-risk task types
</confidence_calibration>

<scoring>
- legalRisk (0–1): 0.90+ = explicit statutory prohibition (AUTHORITATIVE), 0.70–0.89 = unfulfilled AUTHORITATIVE obligation, 0.40–0.69 = REFERENCE-only or grey area, 0–0.39 = no applicable citation
- architecturalExposure (0–1): 0.90+ = Biometric confirmed, 0.70–0.89 = PII confirmed, 0.40–0.69 = Behavioral data, 0–0.39 = no sensitive data confirmed
- overallScore = 0.60 * legalRisk + 0.40 * architecturalExposure
- BLOCK threshold: overallScore >= 0.65 AND confidence >= 0.70 AND ≥1 BLOCK jurisdiction AND ≥1 AUTHORITATIVE citation with excerpt
</scoring>

<output_rules>
Return ONLY valid JSON. No markdown fences. No explanation. No text before or after the JSON object.
</output_rules>

<output_schema>
{
  "decision": "MERGE | BLOCK | ESC_HUMAN",
  "overallScore": 0.0,
  "legalRisk": 0.0,
  "architecturalExposure": 0.0,
  "confidence": 0.0,
  "confidenceRationale": "1–2 sentences: why this confidence level, what single fact would raise it",
  "missingFacts": ["specific facts that if known would materially change this verdict"],
  "prSummary": {
    "headline": "one sentence verdict for the GitHub check title (plain English, no jargon)",
    "reasoning": "2–3 sentence explanation citing the specific law and data path that triggered this decision",
    "intent": "1 sentence: what the engineer was actually trying to build or change"
  },
  "violatingCode": [
    {
      "file": "actual filename from <pr_files> in the brief — never use placeholder paths",
      "lines": "start–end line numbers",
      "snippet": "the exact 1–3 lines of code that cause the compliance risk",
      "issue": "plain-English description of why this specific code is a problem",
      "severity": "HIGH | MEDIUM | LOW",
      "regulation": "regulation name + article that applies to this code"
    }
  ],
  "citations": [
    {
      "id": "citation id from legal_findings",
      "jurisdiction": "string",
      "law": "law name + article/section",
      "excerpt": "verbatim ≤25 words from the provided snippet — REQUIRED for any citation used to justify BLOCK",
      "source_quality": "AUTHORITATIVE | REFERENCE",
      "url": "url from legal_findings if available"
    }
  ],
  "recommendations": ["specific, actionable steps the developer must take — each step must reference a violatingCode file or a missing fact"],
  "jurisdictionBreakdown": [
    { "jurisdiction": "string", "decision": "ALLOW | BLOCK | UNKNOWN", "reason": "string" }
  ],
  "rolePacks": {
    "engineering": {
      "affectedFiles": ["file paths that need changes"],
      "violatingCodeRefs": ["file:lines — references into violatingCode array"],
      "patchGuidance": ["specific code-level fix for each violation, referencing the file and line"],
      "testsToAdd": ["test scenarios that must pass before merge"],
      "rolloutPlan": "suggested phasing: feature flag, canary, consent-gated, etc."
    },
    "legal": {
      "applicableLawSections": ["law name + article + one-sentence obligation this PR triggers"],
      "requiredDocuments": ["specific documents or assessments required before merge (e.g. DPIA, consent form, data processing agreement)"],
      "signOffNeeds": ["who must sign off and under exactly what conditions"]
    },
    "compliance": {
      "checklistItems": ["actionable compliance checklist items, each tied to a specific obligation"],
      "auditArtifacts": ["records or logs that must be retained and for how long"],
      "retentionNotes": "data retention and audit-logging requirements for this feature",
      "dpiaRequired": false
    },
    "leadership": {
      "riskSummary": "2–3 sentence plain-business summary of the risk, no legal jargon",
      "businessExposure": "what could happen if this ships without remediation (fines, sanctions, liability, reputational damage)",
      "recommendedAction": "BLOCK | REVIEW | PROCEED",
      "estimatedResolutionTimeline": "realistic estimate to resolve if escalated (e.g. 1–2 days, 1 week)",
      "regulatoryContext": "one sentence: why this regulation exists and why it applies to this company"
    }
  }
}
</output_schema>

<examples>
<example id="esc-reference-only">
<signal_summary>Sensitive data: behavioral targeting. Source quality: REFERENCE only. Missing facts: user consent status, retention period.</signal_summary>
<expected_decision>ESC_HUMAN</expected_decision>
<why>No AUTHORITATIVE citation present. Cannot BLOCK without authoritative evidence. Missing consent and retention facts prevent a clean MERGE.</why>
</example>

<example id="block-biometric-authoritative">
<signal_summary>Sensitive data: biometric (face vectors). Jurisdiction: Illinois. Source quality: AUTHORITATIVE with snippet. Graph: High exposure — biometric_db confirmed.</signal_summary>
<expected_decision>BLOCK</expected_decision>
<why>AUTHORITATIVE BIPA citation with verbatim excerpt confirms obligation. Infrastructure trace confirms biometric data reaches regulated DB. Confidence >= 0.70 met.</why>
</example>
</examples>`;

/**
 * Convert raw citation strings from Stage 3 into structured objects with stable IDs.
 * This lets Pass 2 reference them by id and provide verbatim excerpts instead of inventing text.
 *
 * Input (Tavily format):  "[AUTHORITATIVE] EU AI Act Art.5 — prohibits real-time remote biometric..."
 * Output: { id, jurisdiction, source_quality, title, snippet, url }
 */
function structureLegalFindings(legalFindings) {
  const structured = [];

  for (const finding of (legalFindings || [])) {
    const jKey = finding.jurisdiction.toLowerCase().replace(/[^a-z]/g, '_');
    const citations = [];

    for (let i = 0; i < (finding.citations || []).length; i++) {
      const raw = finding.citations[i];
      // Detect source quality from the [TAG] prefix
      const isAuth = /\[AUTHORITATIVE/i.test(raw);
      const isTavily = /\[Tavily/i.test(raw);
      const source_quality = isAuth ? 'AUTHORITATIVE' : isTavily ? 'SYNTHESIS' : 'REFERENCE';

      // Strip the tag prefix for the content
      const content = raw
        .replace(/^\[(AUTHORITATIVE|REFERENCE|Tavily[^\]]*)\]\s*/i, '')
        .trim();

      // Pull URL if present (Tavily often embeds them)
      const urlMatch = content.match(/https?:\/\/[^\s,)]+/);
      const url = urlMatch ? urlMatch[0] : null;

      // Excerpt: first 120 chars of substantive text (after stripping URLs)
      const snippet = content.replace(/https?:\/\/[^\s,)]+/g, '').replace(/\s+/g, ' ').trim().slice(0, 200);

      citations.push({
        id: `cit_${jKey}_${i + 1}`,
        source_quality,
        snippet,
        url,
      });
    }

    structured.push({
      jurisdiction: finding.jurisdiction,
      laws: finding.laws || [],
      source_quality: finding.sourceQuality || (citations.some(c => c.source_quality === 'AUTHORITATIVE') ? 'AUTHORITATIVE' : 'REFERENCE'),
      citations,
    });
  }

  return structured;
}

/**
 * Build the signal summary that goes at the top of the user message.
 * Helps the model lock onto the core risk before reading the full brief.
 */
function buildSignalSummary(ctx) {
  const { pr, jurisdictions, intent, graphEvidence, feature } = ctx;

  const sensData = [
    ...(intent?.riskIndicators || []),
    ...(feature?.argusManifest?.dataTags || []),
  ];
  const uniqueSens = [...new Set(sensData)];

  const geoGating = feature?.geoSignals?.length > 0
    ? `YES — ${feature.geoSignals.slice(0, 2).join('; ')}`
    : 'not detected';

  const highRiskJurisdictions = jurisdictions.filter((j) =>
    ['EU', 'Illinois', 'California', 'New York'].includes(j)
  );

  const missingFacts = [];
  if (feature?.missingContext) missingFacts.push('feature context incomplete (no PR description or argus.yaml)');
  if (!intent?.taskType || intent.taskType === 'Unknown') missingFacts.push('task type unclassified');

  const lines = [
    '<signal_summary>',
    `  PR: #${pr.number} "${pr.title}"`,
    `  Developer: ${pr.user}`,
    `  Jurisdictions: ${jurisdictions.join(', ')}`,
    `  Task type: ${intent?.taskType || 'Unknown'}`,
    `  Suspected sensitive data: ${uniqueSens.join(', ') || 'none detected'}`,
    `  Geography gating: ${geoGating}`,
    `  Highest-risk jurisdictions: ${highRiskJurisdictions.join(', ') || 'none flagged'}`,
    `  Graph risk level: ${graphEvidence?.riskLevel || 'Unknown'}`,
    `  Key missing facts: ${missingFacts.length > 0 ? missingFacts.join('; ') : 'none identified'}`,
    '</signal_summary>',
  ];

  return lines.join('\n');
}

/**
 * Build the user message containing all gathered compliance evidence.
 * Uses XML section tags so the model can't blur instructions with data.
 */
function buildComplianceBrief(ctx) {
  const { pr, jurisdictions, intent, legalFindings, graphEvidence } = ctx;
  const structuredFindings = structureLegalFindings(legalFindings);
  const parts = [];

  // ── Preamble ────────────────────────────────────────────────────────────────
  parts.push('<instructions>');
  parts.push('Produce a defensible compliance decision and structured role packs for this PR.');
  parts.push('Return ONLY JSON matching <output_schema> in your system prompt. No prose.');
  parts.push('</instructions>');
  parts.push('');

  // ── Signal summary (top-of-message anchor) ───────────────────────────────────
  parts.push(buildSignalSummary(ctx));
  parts.push('');

  // ── Feature context ──────────────────────────────────────────────────────────
  parts.push('<brief>');
  if (ctx.feature) {
    const f = ctx.feature;
    const featureLines = [
      `Headline: ${f.headline || 'Unknown'}`,
      `Branch: ${f.branchName || 'N/A'}`,
      f.ticketId ? `Ticket ID: ${f.ticketId}` : null,
      `Context Quality: ${f.contextQuality || 'unknown'}`,
      `Missing Context: ${f.missingContext ? 'YES' : 'no'}`,
    ].filter(Boolean);
    if (f.commitSummary) featureLines.push(`Commits: ${f.commitSummary.slice(0, 400)}`);
    if (f.docSnippets)   featureLines.push(`Docs: ${f.docSnippets.slice(0, 400)}`);

    const s = f.prSections || {};
    if (s.featureSummary) featureLines.push(`PR Feature Summary: ${s.featureSummary}`);
    if (s.dataTouched)    featureLines.push(`PR Data Touched: ${s.dataTouched}`);
    if (s.jurisdictions)  featureLines.push(`PR Declared Jurisdictions: ${s.jurisdictions}`);
    if (s.riskNotes)      featureLines.push(`PR Risk Notes: ${s.riskNotes}`);
    if (s.linkedIssue)    featureLines.push(`Linked Issue: #${s.linkedIssue}`);
    if (f.conventionWarnings?.length > 0) {
      featureLines.push(`Convention Warnings: ${f.conventionWarnings.join(' | ')}`);
    }

    const m = f.argusManifest || {};
    if (m.domain)              featureLines.push(`Manifest Domain: ${m.domain}`);
    if (m.dataTags?.length)    featureLines.push(`Manifest Data Types: ${m.dataTags.join(', ')}`);
    if (m.userGeography?.length) featureLines.push(`Manifest User Geography: ${m.userGeography.join(', ')}`);
    if (m.environment)         featureLines.push(`Manifest Environment: ${m.environment}`);

    if (f.serviceDomains?.length)  featureLines.push(`Service Domain(s): ${f.serviceDomains.join(', ')}`);
    const lh = f.lineageHints || {};
    if (lh.writes?.length)   featureLines.push(`Lineage Write Targets: ${lh.writes.join(', ')}`);
    if (lh.reads?.length)    featureLines.push(`Lineage Read Sources: ${lh.reads.join(', ')}`);
    if (lh.streams?.length)  featureLines.push(`Event Stream Topics: ${lh.streams.join(', ')}`);
    if (f.geoSignals?.length) {
      featureLines.push(`Geography/Env Signals: ${f.geoSignals.join(' | ')}`);
    }

    parts.push(featureLines.join('\n'));
  }
  parts.push('');
  parts.push(`Intent — Task Type: ${intent?.taskType || 'Unknown'}`);
  parts.push(`Intent — Risk Indicators: ${(intent?.riskIndicators || []).join(', ') || 'None detected'}`);
  parts.push(`Intent — Models Mentioned: ${(intent?.modelsMentioned || []).join(', ') || 'None'}`);
  parts.push(`Intent — Summary: ${intent?.summary || pr.description || '(none)'}`);
  parts.push('</brief>');
  parts.push('');

  // ── Legal findings (structured with citation IDs) ────────────────────────────
  parts.push('<legal_findings>');
  if (structuredFindings.length === 0) {
    parts.push('<no_findings>No legal research results available for this PR.</no_findings>');
  } else {
    for (const finding of structuredFindings) {
      const jKey = finding.jurisdiction.toLowerCase().replace(/[^a-z]/g, '_');
      parts.push(`<jurisdiction id="${jKey}" name="${finding.jurisdiction}" source_quality="${finding.source_quality}">`);
      if (finding.laws.length > 0) {
        parts.push(`  <applicable_laws>${finding.laws.join(', ')}</applicable_laws>`);
      }
      for (const c of finding.citations) {
        parts.push(`  <citation id="${c.id}" source_quality="${c.source_quality}"${c.url ? ` url="${c.url}"` : ''}>`);
        parts.push(`    ${c.snippet}`);
        parts.push(`  </citation>`);
      }
      parts.push(`</jurisdiction>`);
    }
  }
  parts.push('</legal_findings>');
  parts.push('');

  // ── Changed files (grounds violatingCode file references) ────────────────────
  const changedFiles = (pr.files || []).map((f) => f.filename || f).filter(Boolean);
  if (changedFiles.length > 0) {
    parts.push('<pr_files>');
    changedFiles.slice(0, 30).forEach((f) => parts.push(`  ${f}`));
    parts.push('</pr_files>');
    parts.push('');
  }

  // ── Infrastructure trace ─────────────────────────────────────────────────────
  parts.push('<trace>');
  if (graphEvidence?.pathsFound?.length > 0) {
    parts.push(`<risk_level>${graphEvidence.riskLevel}</risk_level>`);
    parts.push(`<sensitive_data>${(graphEvidence.sensitiveData || []).join(', ')}</sensitive_data>`);
    parts.push('<lineage_paths>');
    graphEvidence.pathsFound.forEach((p) => parts.push(`  ${p}`));
    parts.push('</lineage_paths>');
  } else {
    parts.push('<no_trace>No sensitive data lineage confirmed in infrastructure graph.</no_trace>');
  }
  parts.push('</trace>');

  return parts.join('\n');
}

/**
 * Deterministic fallback verdict — computed WITHOUT OpenAI when quota is exhausted.
 * Uses the gathered data to score and decide. Not as nuanced as GPT-4o, but reliable.
 */
function computeFallbackVerdict(ctx) {
  const { jurisdictions, intent, legalFindings, graphEvidence } = ctx;

  const RISK_DATA_SCORES = { Biometric: 0.95, PII: 0.80, Behavioral: 0.55, Financial: 0.70 };
  const RISK_INDICATOR_SCORES = {
    'Automated Decision-Making': 0.75,
    'PII Processing': 0.70,
    'Behavioral Profiling': 0.60,
    'Biometric Data': 0.90,
    'Individualized Pricing': 0.70,
    'Surveillance': 0.85,
  };

  // Score architectural exposure from graph evidence
  let archExposure = 0;
  for (const dataType of (graphEvidence?.sensitiveData || [])) {
    const score = RISK_DATA_SCORES[dataType] || 0.3;
    if (score > archExposure) archExposure = score;
  }
  if (!graphEvidence?.pathsFound?.length) archExposure = Math.min(archExposure, 0.3);

  // Score legal risk from risk indicators
  let legalRiskSum = 0;
  const indicators = intent?.riskIndicators || [];
  for (const ind of indicators) {
    legalRiskSum += RISK_INDICATOR_SCORES[ind] || 0.4;
  }
  const legalRisk = indicators.length > 0
    ? Math.min(legalRiskSum / indicators.length + 0.15, 1.0)
    : 0.2;

  const overallScore = (0.6 * legalRisk) + (0.4 * archExposure);

  // Build per-jurisdiction breakdown
  const CA_HIGH_RISK_TASKS = ['Individualized Pricing', 'Automated Decision-Making', 'Behavioral Profiling', 'Facial Recognition'];
  const EU_PROHIBITED = ['Surveillance', 'Facial Recognition', 'Social Scoring'];

  const jurisdictionBreakdown = jurisdictions.map((j) => {
    if (j === 'California') {
      const blocked = CA_HIGH_RISK_TASKS.includes(intent?.taskType) &&
        (graphEvidence?.sensitiveData?.includes('PII') || graphEvidence?.sensitiveData?.includes('Biometric'));
      return {
        jurisdiction: 'California',
        decision: blocked ? 'BLOCK' : 'ALLOW',
        reason: blocked
          ? `CCPA §7030 requires a risk assessment before deploying ADMT (${intent?.taskType}) that processes California resident PII. No assessment documented.`
          : `No immediate CCPA violation detected for this task type.`,
      };
    }
    if (j === 'EU') {
      const prohibited = EU_PROHIBITED.includes(intent?.taskType);
      const highRisk  = graphEvidence?.sensitiveData?.includes('Biometric');
      return {
        jurisdiction: 'EU',
        decision: prohibited ? 'BLOCK' : (highRisk ? 'ESC_HUMAN' : 'ALLOW'),
        reason: prohibited
          ? `EU AI Act Article 5 prohibits this class of system.`
          : highRisk
          ? `EU AI Act Article 6 + Annex III: Biometric data involvement may require high-risk AI conformity assessment.`
          : `EU AI Act Article 6: This system requires monitoring but no immediate prohibition applies.`,
      };
    }
    return { jurisdiction: j, decision: 'UNKNOWN', reason: 'No specific law profile available for this jurisdiction.' };
  });

  // Final decision: BLOCK if any jurisdiction blocks + overall score >= 0.65
  const anyBlock = jurisdictionBreakdown.some((j) => j.decision === 'BLOCK');
  const anyEscalate = jurisdictionBreakdown.some((j) => j.decision === 'ESC_HUMAN');

  let decision;
  if (anyBlock && overallScore >= 0.65) decision = 'BLOCK';
  else if (anyEscalate || overallScore >= 0.5) decision = 'ESC_HUMAN';
  else decision = 'MERGE';

  // Build citations from legalFindings
  const citations = [];
  for (const finding of (legalFindings || [])) {
    citations.push(...(finding.citations || []).slice(0, 2));
  }

  const recommendations = [];
  if (decision !== 'MERGE') {
    if (jurisdictions.includes('California') && anyBlock) {
      recommendations.push('Conduct and document a CCPA §7030 ADMT Risk Assessment before deployment');
      recommendations.push('Implement a clear consumer opt-out mechanism for automated decision-making');
      recommendations.push('Register the ADMT system with the California Privacy Protection Agency (CPPA) if required');
    }
    if (jurisdictions.includes('EU')) {
      recommendations.push('Submit EU AI Act Annex III conformity assessment documentation');
      recommendations.push('Ensure GDPR Article 22 right-to-explanation mechanism is implemented');
    }
    recommendations.push('Consult legal counsel for multi-jurisdiction compliance sign-off before merge');
  }

  // Confidence for the fallback: higher when graph evidence is present + AUTHORITATIVE citations exist
  const hasGraph = (graphEvidence?.pathsFound?.length || 0) > 0;
  const hasAuthCitations = (legalFindings || []).some((f) =>
    (f.citations || []).some((c) => /\[AUTHORITATIVE/i.test(c))
  );
  const fallbackConfidence = hasGraph && hasAuthCitations ? 0.65
    : hasGraph || hasAuthCitations ? 0.45
    : 0.25;

  // Apply confidence gate to fallback too: never BLOCK below 0.7
  let finalDecision = decision;
  if (finalDecision === 'BLOCK' && fallbackConfidence < 0.7) {
    finalDecision = 'ESC_HUMAN';
    console.warn(`[adjudicate] Fallback confidence gate: BLOCK → ESC_HUMAN (confidence: ${fallbackConfidence})`);
  }

  const fallbackReasoning = finalDecision === 'BLOCK'
    ? `This PR is BLOCKED because it deploys ${intent?.taskType || 'an AI system'} that is confirmed to process ${graphEvidence?.sensitiveData?.join(' and ') || 'sensitive'} data from ${jurisdictions.join(' and ')} users. ${jurisdictionBreakdown.find(j => j.decision === 'BLOCK')?.reason || ''}`
    : finalDecision === 'ESC_HUMAN'
    ? `This PR requires human review. The task type presents regulatory risk across ${jurisdictions.join(' and ')} but the violation is not clear-cut enough for autonomous blocking. Risk score: ${(overallScore * 100).toFixed(0)}%.`
    : `No blocking compliance violations detected. Risk score is ${(overallScore * 100).toFixed(0)}% — within acceptable threshold.`;

  return {
    decision: finalDecision,
    overallScore:           Math.round(overallScore * 100) / 100,
    legalRisk:              Math.round(legalRisk * 100) / 100,
    architecturalExposure:  Math.round(archExposure * 100) / 100,
    confidence:             fallbackConfidence,
    confidenceRationale:    `Deterministic fallback — confidence based on graph coverage (${hasGraph ? 'yes' : 'no'}) and authoritative citations (${hasAuthCitations ? 'yes' : 'no'}).`,
    missingFacts:           finalDecision !== 'MERGE' ? [
      'Whether the model has been formally registered with applicable regulatory bodies',
      'Whether a prior risk assessment was conducted and documented',
    ] : [],
    prSummary: {
      headline:  fallbackReasoning.slice(0, 120),
      reasoning: fallbackReasoning,
      intent:    intent?.summary || '',
    },
    violatingCode: [],
    reasoning:  fallbackReasoning,
    citations:  citations.slice(0, 5).map((c) => (typeof c === 'string' ? { law: c, source_quality: 'REFERENCE' } : c)),
    recommendations,
    jurisdictionBreakdown,
    rolePacks: null,
    _source: 'deterministic-fallback',
  };
}

const DEFAULT_HIGH_RISK_TASKS = [
  'Biometric Processing', 'Facial Recognition', 'Automated Decision-Making',
  'Individualized Pricing', 'Credit Scoring', 'Insurance Underwriting',
  'Health Data Processing', 'Surveillance', 'Hiring/HR Automation',
];

// Allow teams to override the high-risk task list via ARGUS_HIGH_RISK_TASKS env var
// without requiring a code change. Falls back to the built-in default list.
const HIGH_RISK_TASKS = config.enforcement?.highRiskTasks || DEFAULT_HIGH_RISK_TASKS;

if (config.enforcement?.highRiskTasks) {
  console.log('[adjudicate] High-risk task list overridden via ARGUS_HIGH_RISK_TASKS:', HIGH_RISK_TASKS);
}

/**
 * Option B: Override MERGE → ESC_HUMAN for high-risk tasks with missing context.
 * Only promotes; never demotes BLOCK.
 * @param {object} ctx  Pipeline context (must have ctx.verdict, ctx.feature, ctx.intent, ctx.graphEvidence)
 */
function applyOptionBOverride(ctx) {
  if (ctx.verdict.decision !== 'MERGE' || !ctx.feature?.missingContext) return;
  const highRiskGraph = ['Critical', 'High'].includes(ctx.graphEvidence?.riskLevel);
  const highRiskTask = HIGH_RISK_TASKS.includes(ctx.intent?.taskType);
  if (!highRiskTask && !highRiskGraph) return;
  console.warn('[adjudicate] Option B override: MERGE → ESC_HUMAN (high-risk + missing context)');
  ctx.verdict = {
    ...ctx.verdict,
    decision: 'ESC_HUMAN',
    reasoning: (ctx.verdict.reasoning || '') +
      ' [Argus Policy Override] High-risk feature lacks sufficient context for automated compliance adjudication. Escalating to human review.',
    recommendations: [
      'Add a detailed PR description with feature summary and data touched',
      'Include jurisdiction declarations (e.g. "Jurisdiction: California, EU")',
      'Link to a feature spec, RFC, or issue ticket',
      ...(ctx.verdict.recommendations || []),
    ],
    _source: (ctx.verdict._source || '') + '+option-b-override',
  };
}

/**
 * Phase 3 — Pass 1: Run the Analysis Draft using gpt-4o-mini.
 * Generates risk hypotheses, key uncertainties, and targeted Tavily queries.
 * Non-fatal — if it fails, adjudication continues without the draft.
 *
 * @param {object} ctx
 * @param {string} brief  Compiled compliance brief text
 * @returns {Promise<{ riskHypotheses, keyUncertainties, targetedQueries, confidencePrior }|null>}
 */
async function runAnalysisDraft(ctx, brief) {
  try {
    console.log(`[adjudicate] Pass 1 — Analysis Draft (${llm.MODELS.mini})…`);
    const response = await llm.chat({
      model:           llm.MODELS.mini,
      messages: [
        { role: 'system', content: ANALYSIS_DRAFT_PROMPT },
        { role: 'user',   content: brief },
      ],
      temperature:     0.1,
      max_tokens:      8192,
      response_format: { type: 'json_object' },
    });
    const draft = JSON.parse(response.choices[0].message.content);
    console.log(`[adjudicate] Analysis Draft — ${draft.riskHypotheses?.length || 0} hypotheses, confidencePrior: ${draft.confidencePrior}, targeted queries: ${draft.targetedQueries?.length || 0}`);
    return draft;
  } catch (err) {
    console.warn('[adjudicate] Analysis Draft failed (continuing without it):', err.message);
    return null;
  }
}

/**
 * Phase 3 — Evidence top-up: run targeted queries from the Analysis Draft
 * and merge the results into ctx.legalFindings.
 *
 * @param {object} ctx
 * @param {Array<{ jurisdiction, query }>} targetedQueries
 */
async function topUpEvidence(ctx, targetedQueries) {
  if (!targetedQueries || targetedQueries.length === 0) return;
  try {
    console.log(`[adjudicate] Evidence top-up — running ${targetedQueries.length} targeted queries…`);
    const supplemental = await researchTargeted(targetedQueries, ctx.intent?.taskType || '');
    if (supplemental.length === 0) return;

    // Merge supplemental findings into existing legalFindings by jurisdiction
    const existing = ctx.legalFindings || [];
    for (const sup of supplemental) {
      const match = existing.find((f) => f.jurisdiction === sup.jurisdiction);
      if (match) {
        match.citations.push(...sup.citations);
        sup.laws.forEach((l) => { if (!match.laws.includes(l)) match.laws.push(l); });
        if (sup.sourceQuality === 'authoritative') match.sourceQuality = 'authoritative';
      } else {
        existing.push(sup);
      }
    }
    ctx.legalFindings = existing;
    console.log(`[adjudicate] Evidence top-up added findings for: ${supplemental.map((s) => s.jurisdiction).join(', ')}`);
  } catch (err) {
    console.warn('[adjudicate] Evidence top-up failed (continuing):', err.message);
  }
}

/**
 * Phase 1 — Confidence gate: demote BLOCK → ESC_HUMAN if confidence is below threshold.
 * Adds missing facts to recommendations so the developer knows what would justify a block.
 *
 * @param {object} verdict  Parsed GPT verdict (mutated in place)
 */
function applyConfidenceGate(verdict) {
  const confidence = verdict.confidence || 0;
  if (verdict.decision !== 'BLOCK') return;

  if (confidence < 0.7) {
    console.warn(`[adjudicate] Confidence gate: BLOCK demoted → ESC_HUMAN (confidence: ${confidence})`);
    verdict.decision = 'ESC_HUMAN';
    verdict.reasoning = (verdict.reasoning || '') +
      ` [Confidence Gate] Insufficient evidence confidence (${(confidence * 100).toFixed(0)}%) to autonomously block — escalating for human review.`;
    if (verdict.missingFacts?.length > 0) {
      verdict.recommendations = [
        ...verdict.missingFacts.map((f) => `Provide evidence for: ${f}`),
        ...(verdict.recommendations || []),
      ];
    }
    verdict._confidenceDemoted = true;
  }
}

/**
 * @param {object} ctx  Pipeline context (needs ctx.intent, ctx.legalFindings, ctx.graphEvidence)
 * @returns {Promise<object>} ctx with ctx.verdict and ctx.analysisDraft populated
 */
async function adjudicate(ctx) {
  console.log('[adjudicate] Stage 5 — Adjudicate starting (two-pass)…');

  const { intent } = ctx;
  if (!intent) throw new Error('[adjudicate] ctx.intent missing — run Stage 2 first');

  // Build the initial compliance brief
  const brief = buildComplianceBrief(ctx);

  // ── Pass 1: Analysis Draft + evidence top-up ──────────────────────────────
  const draft = await runAnalysisDraft(ctx, brief);
  ctx.analysisDraft = draft;

  if (draft?.targetedQueries?.length > 0) {
    await topUpEvidence(ctx, draft.targetedQueries);
  }

  // Rebuild brief with any newly added evidence from the top-up
  const enrichedBrief = draft?.targetedQueries?.length > 0
    ? buildComplianceBrief(ctx) + (draft
      ? `\n\n--- ANALYSIS DRAFT (Pass 1) ---\nRisk Hypotheses:\n${(draft.riskHypotheses || []).map((h) => `  • ${h}`).join('\n')}\nKey Uncertainties:\n${(draft.keyUncertainties || []).map((u) => `  • ${u}`).join('\n')}\nConfidence Prior: ${draft.confidencePrior || 'unknown'}`
      : '')
    : brief + (draft
      ? `\n\n--- ANALYSIS DRAFT (Pass 1) ---\nRisk Hypotheses:\n${(draft.riskHypotheses || []).map((h) => `  • ${h}`).join('\n')}\nKey Uncertainties:\n${(draft.keyUncertainties || []).map((u) => `  • ${u}`).join('\n')}\nConfidence Prior: ${draft.confidencePrior || 'unknown'}`
      : '');

  // ── Pass 2: Final Compliance Report ──────────────────────────────────────
  let raw;
  try {
    console.log(`[adjudicate] Pass 2 — Final Compliance Report (${llm.MODELS.main})…`);
    const response = await llm.chat({
      model:           llm.MODELS.main,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: enrichedBrief },
      ],
      temperature:     0.1,
      max_tokens:      8192,
      response_format: { type: 'json_object' },
    });
    raw = response.choices[0].message.content;
  } catch (err) {
    console.warn('[adjudicate] LLM unavailable — switching to deterministic fallback:', err.message);
    ctx.verdict = computeFallbackVerdict(ctx);
    applyOptionBOverride(ctx);
    console.log(`[adjudicate] Fallback verdict: ${ctx.verdict.decision} (score: ${ctx.verdict.overallScore})`);
    console.log('[adjudicate] Stage 5 complete (deterministic fallback) ✓');
    return ctx;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[adjudicate] Failed to parse LLM JSON — falling back');
    ctx.verdict = computeFallbackVerdict(ctx);
    applyOptionBOverride(ctx);
    return ctx;
  }

  const prSummary = parsed.prSummary || {
    headline:  parsed.reasoning?.slice(0, 120) || '',
    reasoning: parsed.reasoning                || '',
    intent:    '',
  };

  ctx.verdict = {
    decision:               parsed.decision              || 'ESC_HUMAN',
    overallScore:           parsed.overallScore          || 0,
    legalRisk:              parsed.legalRisk             || 0,
    architecturalExposure:  parsed.architecturalExposure || 0,
    confidence:             parsed.confidence            || 0,
    confidenceRationale:    parsed.confidenceRationale   || '',
    missingFacts:           Array.isArray(parsed.missingFacts)          ? parsed.missingFacts          : [],
    // Structured PR summary (used by checks.js check title + comment header)
    prSummary,
    // Top-level reasoning alias for backward-compatible consumers (supabase.js, comments.js)
    reasoning: prSummary.reasoning || parsed.reasoning || '',
    // Specific code locations that caused the issue — used by checks.js annotations
    violatingCode: Array.isArray(parsed.violatingCode) ? parsed.violatingCode : [],
    // Citations are now objects; keep backward-compat by exposing .text for any legacy readers
    citations: Array.isArray(parsed.citations)
      ? parsed.citations.map((c) => (typeof c === 'string' ? { law: c, source_quality: 'REFERENCE' } : c))
      : [],
    recommendations:       Array.isArray(parsed.recommendations)       ? parsed.recommendations       : [],
    jurisdictionBreakdown: Array.isArray(parsed.jurisdictionBreakdown) ? parsed.jurisdictionBreakdown : [],
    rolePacks:             parsed.rolePacks || null,
    _source: `${config.llm.provider}:${llm.MODELS.main}`,
  };

  // Phase 1: apply confidence gate before any other overrides
  applyConfidenceGate(ctx.verdict);
  applyOptionBOverride(ctx);

  console.log(`[adjudicate] GPT-4o verdict: ${ctx.verdict.decision} (score: ${ctx.verdict.overallScore}, confidence: ${ctx.verdict.confidence})`);
  if (ctx.verdict._confidenceDemoted) {
    console.warn('[adjudicate] Note: verdict was demoted from BLOCK due to low confidence');
  }
  console.log('[adjudicate] Stage 5 complete ✓');
  return ctx;
}

module.exports = { adjudicate, computeFallbackVerdict };
