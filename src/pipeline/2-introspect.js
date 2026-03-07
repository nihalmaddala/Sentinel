'use strict';

const llm    = require('../llm/client');
const config = require('../config');

/**
 * Stage 2 — Introspect
 * Calls OpenAI (GPT-4o) to classify the PR's technical intent.
 * Populates ctx.intent with:
 *   taskType       — canonical AI/data task category (e.g. "Individualized Pricing")
 *   riskIndicators — array of regulatory risk flags (e.g. ["Automated Decision-Making", "PII"])
 *   modelsMentioned — any AI model names detected in the PR
 *   summary        — one-sentence plain-English summary of what the PR does
 */

const SYSTEM_PROMPT = `You are a compliance-aware AI system analyst embedded in a CI/CD pipeline.
Your job is to read a Pull Request title, description, and code diff and extract its technical intent for regulatory analysis.
When a code diff is provided, treat it as ground truth — it overrides vague or misleading PR descriptions.
Look for: model class names, database references, API calls, import statements, and any hardcoded identifiers like model names or DB connection strings.

You also receive feature-level context: branch name, commit messages, and documentation snippets.
Use branch name and commit messages as primary feature-intent signals — they reveal what the developer intended.
Documentation snippets (from docs/, rfc/, adr/) provide authoritative feature specs.
The code diff is secondary confirmation. If branch/commits and diff conflict, flag the discrepancy in your summary.

Respond ONLY with a valid JSON object matching this exact schema — no markdown, no explanation:
{
  "taskType": "string — canonical AI/data task name (e.g. Individualized Pricing, Facial Recognition, Content Recommendation, Automated Decision-Making, Biometric Processing, Behavioral Profiling, Credit Scoring)",
  "riskIndicators": ["array of regulatory risk flags from this set: Automated Decision-Making, PII Processing, Biometric Data, Location Tracking, Behavioral Profiling, Individualized Pricing, Financial Decisioning, Surveillance, Content Moderation, Hiring/HR Automation"],
  "modelsMentioned": ["array of any AI model names or identifiers mentioned in the PR, empty array if none"],
  "dataSourcesMentioned": ["array of any database or data source names mentioned, empty array if none"],
  "impliedJurisdictions": ["array of jurisdiction names that are implicitly regulated by this task type, regardless of whether the developer mentioned them — e.g. Facial Recognition always implies Illinois (BIPA) and EU (AI Act Art.5); Individualized Pricing implies California (CCPA ADMT) and EU (AI Act); Credit Scoring implies California, EU, New York; Behavioral Profiling implies California, EU"],
  "summary": "one-sentence plain-English description of what this PR does"
}

JURISDICTION IMPLICATION RULES (apply regardless of what the developer wrote):
- Facial Recognition, Biometric Processing → always include Illinois, California, EU
- Individualized Pricing, Behavioral Profiling → always include California, EU
- Credit Scoring, Financial Decisioning → always include California, EU, New York
- Automated Decision-Making → always include California, EU
- Hiring/HR Automation → always include New York, EU
- Surveillance → always include EU, California
- If uncertain, include California and EU as the two strictest default regimes`;

// Static fallback map when OpenAI is unavailable or returns no impliedJurisdictions.
// Ensures autonomous jurisdiction inference even without LLM.
const TASK_JURISDICTION_MAP = {
  'Facial Recognition':        ['California', 'Illinois', 'EU'],
  'Biometric Processing':      ['California', 'Illinois', 'EU'],
  'Individualized Pricing':    ['California', 'EU'],
  'Behavioral Profiling':      ['California', 'EU'],
  'Credit Scoring':            ['California', 'EU', 'New York'],
  'Financial Decisioning':     ['California', 'EU', 'New York'],
  'Automated Decision-Making': ['California', 'EU'],
  'Fraud Detection':           ['California', 'EU'],
  'Hiring/HR Automation':      ['New York', 'EU'],
  'Surveillance':              ['EU', 'California'],
  'Content Recommendation':    ['EU'],
};

/**
 * @param {object} ctx  Pipeline context (must have ctx.pr populated by Stage 1)
 * @returns {Promise<object>} ctx with ctx.intent populated
 */
async function introspect(ctx) {
  console.log('[introspect] Stage 2 — Introspect starting…');

  const { pr } = ctx;
  if (!pr) throw new Error('[introspect] ctx.pr is missing — run Stage 1 first');

  const feature = ctx.feature || {};
  const branchSection = feature.branchName
    ? `\n\n## Branch: ${feature.branchName}${feature.ticketId ? ` (Ticket: ${feature.ticketId})` : ''}`
    : '';
  const commitSection = feature.commitSummary
    ? `\n\n## Commit Messages:\n${feature.commitSummary}`
    : '';
  const docSection = feature.docSnippets
    ? `\n\n## Documentation Snippets:\n${feature.docSnippets}`
    : '';

  // Structured PR template sections (Feature Summary, Data Touched, Jurisdictions, etc.)
  const sections = feature.prSections || {};
  const prSectionsLines = [];
  if (sections.featureSummary) prSectionsLines.push(`Feature Summary: ${sections.featureSummary}`);
  if (sections.dataTouched)    prSectionsLines.push(`Data Touched: ${sections.dataTouched}`);
  if (sections.jurisdictions)  prSectionsLines.push(`Declared Jurisdictions: ${sections.jurisdictions}`);
  if (sections.riskNotes)      prSectionsLines.push(`Risk Notes: ${sections.riskNotes}`);
  if (sections.linkedIssue)    prSectionsLines.push(`Linked Issue: #${sections.linkedIssue}`);
  const prSectionsSection = prSectionsLines.length > 0
    ? `\n\n## PR Template Sections:\n${prSectionsLines.join('\n')}`
    : '';

  // Service enrichment signals (domain, lineage, manifest, geo)
  const enrichmentLines = [];
  if (feature.serviceDomains?.length > 0) {
    enrichmentLines.push(`Service Domain(s): ${feature.serviceDomains.join(', ')} — use this to constrain your task type classification`);
  }
  if (feature.argusManifest && Object.keys(feature.argusManifest).length > 0) {
    const m = feature.argusManifest;
    if (m.domain)        enrichmentLines.push(`argus.yaml domain: ${m.domain}`);
    if (m.dataTags?.length > 0) enrichmentLines.push(`argus.yaml declared data types: ${m.dataTags.join(', ')}`);
    if (m.userGeography?.length > 0) enrichmentLines.push(`argus.yaml user geography: ${m.userGeography.join(', ')}`);
    if (m.environment)   enrichmentLines.push(`argus.yaml environment: ${m.environment}`);
  }
  const lineage = feature.lineageHints || {};
  if (lineage.writes?.length > 0)  enrichmentLines.push(`Data write targets (from diff): ${lineage.writes.join(', ')}`);
  if (lineage.reads?.length > 0)   enrichmentLines.push(`Data read sources (from diff): ${lineage.reads.join(', ')}`);
  if (lineage.streams?.length > 0) enrichmentLines.push(`Event stream topics (from diff): ${lineage.streams.join(', ')}`);
  if (feature.geoSignals?.length > 0) {
    enrichmentLines.push(`Geography/environment signals detected in diff:\n${feature.geoSignals.map((s) => `  - ${s}`).join('\n')}`);
  }
  const enrichmentSection = enrichmentLines.length > 0
    ? `\n\n## Service Enrichment Signals (deterministic — high trust):\n${enrichmentLines.join('\n')}`
    : '';

  const diffSection = pr.diff
    ? `\n\n## Code Diff (actual changes):\n${pr.diff}`
    : '\n\n## Code Diff: (not available — analysis based on PR metadata only)';

  const userMessage = `PR Title: ${pr.title}\n\nPR Description:\n${pr.description || '(no description provided)'}${branchSection}${commitSection}${docSection}${prSectionsSection}${enrichmentSection}${diffSection}`;

  let raw;
  try {
    // Use the mini model for classification — fast, cheap, sufficient accuracy
    const response = await llm.chat({
      model:           llm.MODELS.mini,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user',   content: userMessage },
      ],
      temperature:     0.1,
      max_tokens:      8192,
      response_format: { type: 'json_object' },
    });
    raw = response.choices[0].message.content;
  } catch (err) {
    console.error('[introspect] LLM call failed:', err.message);
    // Graceful fallback — don't crash the pipeline
    ctx.intent = {
      taskType: 'Unknown',
      riskIndicators: [],
      modelsMentioned: [],
      dataSourcesMentioned: [],
      summary: `Could not classify PR "${pr.title}" — LLM error: ${err.message}`,
    };
    return ctx;
  }

  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.error('[introspect] Failed to parse LLM JSON response:', raw);
    parsed = {
      taskType: 'Unknown',
      riskIndicators: [],
      modelsMentioned: [],
      dataSourcesMentioned: [],
      summary: pr.title,
    };
  }

  ctx.intent = {
    taskType:            parsed.taskType            || 'Unknown',
    riskIndicators:      Array.isArray(parsed.riskIndicators)      ? parsed.riskIndicators      : [],
    modelsMentioned:     Array.isArray(parsed.modelsMentioned)     ? parsed.modelsMentioned     : [],
    dataSourcesMentioned:Array.isArray(parsed.dataSourcesMentioned)? parsed.dataSourcesMentioned: [],
    impliedJurisdictions:Array.isArray(parsed.impliedJurisdictions)? parsed.impliedJurisdictions: [],
    summary:             parsed.summary             || pr.title,
  };

  // Merge implied jurisdictions (from GPT-4o) into ctx.jurisdictions.
  // This is the key autonomy step: if Stage 1 found no jurisdiction signals,
  // Stage 2 fills the gap based on what the task type legally implies.
  // We also apply the static fallback map in case GPT-4o returned nothing.
  const staticImplied = TASK_JURISDICTION_MAP[ctx.intent.taskType] || [];
  const allImplied = [...new Set([...ctx.intent.impliedJurisdictions, ...staticImplied])];

  if (allImplied.length > 0 && ctx.jurisdictions) {
    const before = [...ctx.jurisdictions];
    // Absorb all implied jurisdictions; remove the weak 'Global' placeholder
    // only if we now have real jurisdictions to replace it with
    const merged = [...new Set([
      ...ctx.jurisdictions.filter((j) => j !== 'Global'),
      ...allImplied,
    ])];
    if (merged.length > 0) {
      ctx.jurisdictions = merged;
      const added = merged.filter((j) => !before.includes(j));
      if (added.length > 0) {
        console.log(`[introspect] Autonomously added jurisdictions from task type: ${added.join(', ')}`);
      }
    }
  }

  console.log(`[introspect] Task type: ${ctx.intent.taskType}`);
  console.log(`[introspect] Risk indicators: ${ctx.intent.riskIndicators.join(', ') || 'none'}`);
  console.log(`[introspect] Models mentioned: ${ctx.intent.modelsMentioned.join(', ') || 'none'}`);
  console.log(`[introspect] Active jurisdictions: ${ctx.jurisdictions?.join(', ')}`);
  console.log('[introspect] Stage 2 complete ✓');

  return ctx;
}

module.exports = { introspect };
