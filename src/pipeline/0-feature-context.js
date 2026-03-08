'use strict';

/**
 * Feature Context Enrichment — runs after Intercept, before Introspect.
 * Builds ctx.feature from branch name, commit messages, doc file patches,
 * service domain classification, data lineage hints, argus.yaml manifests,
 * and environment/geography signals extracted from the diff.
 * No external API calls; uses data already on ctx.pr.
 */

const MAX_COMMIT_SUMMARY_CHARS = 2000;
const MAX_DOC_SNIPPETS_CHARS = 3000;
const MIN_MEANINGFUL_BODY_LENGTH = 20;

const DOC_PATH_PREFIXES = ['docs/', 'rfc/', 'adr/', '.github/', 'specs/', 'design/', 'compliance/', 'legal/'];

// ── Service domain map ────────────────────────────────────────────────────────
// Maps file path prefixes to canonical service domains.
// The FIRST match wins (ordered from most to least specific).
const SERVICE_DOMAIN_MAP = [
  { prefix: /^src\/pay/i,          domain: 'payments' },
  { prefix: /^src\/billing/i,      domain: 'payments' },
  { prefix: /^src\/checkout/i,     domain: 'payments' },
  { prefix: /^src\/health/i,       domain: 'healthcare' },
  { prefix: /^src\/medical/i,      domain: 'healthcare' },
  { prefix: /^src\/clinical/i,     domain: 'healthcare' },
  { prefix: /^src\/hir/i,          domain: 'hiring' },
  { prefix: /^src\/recruit/i,      domain: 'hiring' },
  { prefix: /^src\/hr\b/i,         domain: 'hiring' },
  { prefix: /^src\/insur/i,        domain: 'insurance' },
  { prefix: /^src\/underwr/i,      domain: 'insurance' },
  { prefix: /^src\/edu/i,          domain: 'education' },
  { prefix: /^src\/school/i,       domain: 'education' },
  { prefix: /^src\/learn/i,        domain: 'education' },
  { prefix: /^src\/ad[s/]/i,       domain: 'advertising' },
  { prefix: /^src\/market/i,       domain: 'advertising' },
  { prefix: /^src\/credit/i,       domain: 'financial_services' },
  { prefix: /^src\/loan/i,         domain: 'financial_services' },
  { prefix: /^src\/fraud/i,        domain: 'financial_services' },
  { prefix: /^src\/biometric/i,    domain: 'biometrics' },
  { prefix: /^src\/face/i,         domain: 'biometrics' },
  { prefix: /^src\/identity/i,     domain: 'identity' },
  { prefix: /^src\/auth/i,         domain: 'identity' },
  { prefix: /^src\/user/i,         domain: 'user_data' },
  { prefix: /^src\/profile/i,      domain: 'user_data' },
  { prefix: /^src\/recommend/i,    domain: 'recommendations' },
  { prefix: /^src\/content/i,      domain: 'content' },
  { prefix: /^src\/social/i,       domain: 'social' },
  { prefix: /^src\/surveillance/i, domain: 'surveillance' },
  { prefix: /^src\/monitor/i,      domain: 'surveillance' },
];

// ── Data lineage patterns ─────────────────────────────────────────────────────
// Regex patterns to extract table/model/topic names from the diff.
const LINEAGE_PATTERNS = [
  // ORM: Model.create(), Model.save(), Model.findAll(), etc.
  { regex: /\b([A-Z][a-zA-Z0-9_]+)\.(create|save|update|upsert|bulkCreate|insert)\s*\(/g, role: 'write' },
  { regex: /\b([A-Z][a-zA-Z0-9_]+)\.(find|findAll|findOne|findBy|select|query|get)\s*\(/g, role: 'read' },
  // Raw SQL
  { regex: /INSERT\s+INTO\s+["`']?(\w+)["`']?/gi, role: 'write' },
  { regex: /UPDATE\s+["`']?(\w+)["`']?\s+SET/gi,  role: 'write' },
  { regex: /FROM\s+["`']?(\w+)["`']?/gi,           role: 'read' },
  // Kafka / event streams
  { regex: /producer\.send\s*\(\s*['"`]([^'"`]+)['"`]/g, role: 'publish' },
  { regex: /consumer\.subscribe\s*\(\s*\[?\s*['"`]([^'"`]+)['"`]/g, role: 'subscribe' },
  { regex: /\.topic\s*[=:]\s*['"`]([^'"`]+)['"`]/g, role: 'publish' },
  // DB connection strings / table references
  { regex: /tableName\s*[=:]\s*['"`](\w+)['"`]/g, role: 'read' },
  { regex: /collection\s*[=:]\s*['"`](\w+)['"`]/g, role: 'read' },
];

// Names too generic to be useful lineage signal
const LINEAGE_STOP_WORDS = new Set([
  'id', 'data', 'result', 'results', 'record', 'records', 'item', 'items',
  'row', 'rows', 'value', 'values', 'response', 'request', 'query', 'model',
  'table', 'db', 'database', 'select', 'from', 'where', 'the', 'and',
]);

// ── Geography / environment signal patterns ───────────────────────────────────
const GEO_PATTERNS = [
  // Explicit country/region checks
  { regex: /user\.(country|region|locale)\s*[=!]=\s*['"`]([^'"`]+)['"`]/gi, type: 'user_geo_check' },
  { regex: /locale\s*[=!]=\s*['"`]([^'"`]+)['"`]/gi,                         type: 'locale_check' },
  { regex: /country\s*[=!]=\s*['"`]([^'"`]+)['"`]/gi,                         type: 'country_check' },
  // Environment variables hinting at geography
  { regex: /process\.env\.([A-Z_]*(EU|CA|UK|GDPR|CCPA|HIPAA|COPPA)[A-Z_]*)/g, type: 'env_geo_flag' },
  // Feature flags with geography/compliance keywords
  { regex: /(?:featureFlag|getFlag|isEnabled|flagsmith|launchdarkly)\s*\(\s*['"`]([^'"`]*(eu|gdpr|ccpa|ca_|hipaa|coppa)[^'"`]*)['"`]/gi, type: 'feature_flag_geo' },
  // Consent / privacy gate patterns
  { regex: /(?:hasConsent|checkConsent|gdprConsent|consentGiven)\s*\(/gi,       type: 'consent_gate' },
  { regex: /(?:isEUUser|isCaliforniaResident|isInEU|inGDPRRegion)\s*\(/gi,     type: 'geo_guard_fn' },
];

// ── argus.yaml data classification tags ──────────────────────────────────────
// Recognised tag values from argus.yaml `data_types` field.
const KNOWN_DATA_TAGS = new Set([
  'pii', 'biometric', 'health', 'financial', 'behavioral', 'location',
  'precise_geolocation', 'children', 'sensitive', 'anonymized',
]);

const VAGUE_BRANCH_REGEX = /^(fix|update|patch|hotfix|main|master|dev|develop)$/i;

const TRIVIAL_COMMIT_REGEX = /^(merge\s+(branch|pull request)|fixup!|wip|fix|update|bump|chore|style|refactor\s*:?)\s*$/i;

// PR template section headers to extract
const PR_TEMPLATE_SECTIONS = [
  { key: 'featureSummary',  regex: /#+\s*feature\s*summary[:\s]*\n([\s\S]*?)(?=\n#+|$)/i },
  { key: 'dataTouched',     regex: /#+\s*data\s*touched[:\s]*\n([\s\S]*?)(?=\n#+|$)/i },
  { key: 'jurisdictions',   regex: /#+\s*jurisdictions?[:\s]*\n([\s\S]*?)(?=\n#+|$)/i },
  { key: 'riskNotes',       regex: /#+\s*risk\s*notes?[:\s]*\n([\s\S]*?)(?=\n#+|$)/i },
  { key: 'linkedIssue',     regex: /(?:closes?|fixes?|resolves?)\s+#(\d+)/i },
];

/**
 * Parse structured sections out of the PR body using markdown header patterns.
 * @param {string} body  PR description text
 * @returns {{ featureSummary?, dataTouched?, jurisdictions?, riskNotes?, linkedIssue? }}
 */
function parsePRTemplateSections(body) {
  if (!body || typeof body !== 'string') return {};
  const sections = {};
  for (const { key, regex } of PR_TEMPLATE_SECTIONS) {
    const match = body.match(regex);
    if (match) {
      sections[key] = (match[1] || match[0]).trim().slice(0, 800);
    }
  }
  return sections;
}

/**
 * Derive a human-readable headline from branch name.
 * Strips common prefixes (feat/, fix/, chore/) and ticket ID patterns
 * including Jira-style (PROJ-123-) and numeric (123-) prefixes.
 * Also extracts ticketId if present.
 *
 * @param {string|null} branchRef
 * @param {string} fallbackTitle  PR title
 * @returns {{ headline: string, ticketId: string|null }}
 */
function headlineFromBranch(branchRef, fallbackTitle) {
  if (!branchRef || typeof branchRef !== 'string') return { headline: fallbackTitle || '', ticketId: null };
  let slug = branchRef.trim();
  if (!slug) return { headline: fallbackTitle || '', ticketId: null };

  slug = slug.replace(/^(feat(ure)?|fix|chore|refactor|docs?)\//i, '').trim();

  // Extract Jira-style ticket (e.g. PROJ-123 or ARG-42)
  let ticketId = null;
  const jiraMatch = slug.match(/^([A-Z][A-Z0-9]+-\d+)-?/i);
  if (jiraMatch) {
    ticketId = jiraMatch[1].toUpperCase();
    slug = slug.slice(jiraMatch[0].length).trim();
  }

  slug = slug.replace(/[-_]+/g, ' ').trim();
  if (slug.length < 2) return { headline: fallbackTitle || '', ticketId };
  return { headline: slug.charAt(0).toUpperCase() + slug.slice(1), ticketId };
}

/**
 * Check if branch name is vague (no signal).
 * @param {string|null} ref
 * @returns {boolean}
 */
function isVagueBranch(ref) {
  if (!ref || typeof ref !== 'string') return true;
  const t = ref.trim();
  return !t || VAGUE_BRANCH_REGEX.test(t);
}

/**
 * Filter to meaningful commit messages (skip merge, fixup, trivial).
 * @param {Array<{ message: string }>} commits
 * @returns {string[]}
 */
function meaningfulCommitMessages(commits) {
  if (!Array.isArray(commits)) return [];
  const out = [];
  for (const c of commits) {
    const msg = (c.message || '').trim();
    if (!msg) continue;
    if (TRIVIAL_COMMIT_REGEX.test(msg)) continue;
    if (msg.length < 10) continue;
    out.push(msg);
  }
  return out;
}

/**
 * Extract doc snippets from PR files (paths under docs/, rfc/, adr/, .github/).
 * @param {Array<{ filename?: string, patch?: string }>} files
 * @returns {string}
 */
function buildDocSnippets(files) {
  if (!Array.isArray(files)) return '';
  const parts = [];
  let total = 0;
  for (const f of files) {
    const path = (f.filename || '').trim();
    if (!path) continue;
    const isDoc = DOC_PATH_PREFIXES.some((p) => path.startsWith(p));
    if (!isDoc) continue;
    const patch = (f.patch || '').trim();
    if (!patch) continue;
    const snippet = `[${path}]\n${patch.slice(0, 1500)}`;
    if (total + snippet.length > MAX_DOC_SNIPPETS_CHARS) {
      parts.push(snippet.slice(0, MAX_DOC_SNIPPETS_CHARS - total));
      break;
    }
    parts.push(snippet);
    total += snippet.length;
  }
  return parts.join('\n\n');
}

/**
 * Classify service domains from the set of changed file paths.
 * Returns the deduplicated list of matched domains (e.g. ['payments', 'user_data']).
 * @param {Array<{ filename?: string }>} files
 * @returns {string[]}
 */
function classifyServiceDomains(files) {
  if (!Array.isArray(files)) return [];
  const found = new Set();
  for (const f of files) {
    const path = (f.filename || '').trim();
    if (!path) continue;
    for (const { prefix, domain } of SERVICE_DOMAIN_MAP) {
      if (prefix.test(path)) {
        found.add(domain);
        break; // first match wins per file
      }
    }
  }
  return [...found];
}

/**
 * Extract crude data lineage hints from the PR diff text.
 * Returns { writes: string[], reads: string[], streams: string[] }
 * @param {string|null} diff
 * @returns {{ writes: string[], reads: string[], streams: string[] }}
 */
function extractLineageHints(diff) {
  const result = { writes: [], reads: [], streams: [] };
  if (!diff || typeof diff !== 'string') return result;

  const writes  = new Set();
  const reads   = new Set();
  const streams = new Set();

  // Only scan added lines (prefixed with +) to avoid noise from removed code
  const addedLines = diff
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .join('\n');

  for (const { regex, role } of LINEAGE_PATTERNS) {
    const re = new RegExp(regex.source, regex.flags);
    let match;
    while ((match = re.exec(addedLines)) !== null) {
      const name = (match[1] || '').trim().toLowerCase();
      if (!name || name.length < 3 || LINEAGE_STOP_WORDS.has(name)) continue;
      if (role === 'write')                writes.add(match[1].trim());
      else if (role === 'read')            reads.add(match[1].trim());
      else if (role === 'publish' || role === 'subscribe') streams.add(match[1].trim());
    }
  }

  return {
    writes:  [...writes].slice(0, 20),
    reads:   [...reads].slice(0, 20),
    streams: [...streams].slice(0, 10),
  };
}

/**
 * Parse argus.yaml manifest patches from changed files.
 * Looks for files named argus.yaml anywhere in the changed file list,
 * then parses key: value lines from their patch content.
 *
 * Recognised fields: domain, data_types, user_geography, environment
 *
 * @param {Array<{ filename?: string, patch?: string }>} files
 * @returns {{ domain?: string, dataTags?: string[], userGeography?: string[], environment?: string }}
 */
function parseSentinelManifests(files) {
  if (!Array.isArray(files)) return {};
  const result = {};

  for (const f of files) {
    const path = (f.filename || '').trim();
    if (!path.endsWith('argus.yaml') && !path.endsWith('argus.yml')) continue;
    const patch = (f.patch || '').trim();
    if (!patch) continue;

    // Extract added/context lines from the patch
    const lines = patch.split('\n')
      .filter((l) => !l.startsWith('-'))
      .map((l) => l.replace(/^[+ ]/, '').trim())
      .filter(Boolean);

    for (const line of lines) {
      const domainMatch = line.match(/^domain\s*:\s*(.+)/i);
      if (domainMatch) result.domain = domainMatch[1].trim().toLowerCase();

      const dataTypesMatch = line.match(/^data_types\s*:\s*\[(.+)\]/i);
      if (dataTypesMatch) {
        result.dataTags = dataTypesMatch[1]
          .split(',')
          .map((t) => t.trim().replace(/['"]/g, '').toLowerCase())
          .filter((t) => KNOWN_DATA_TAGS.has(t));
      }

      const geoMatch = line.match(/^user_geography\s*:\s*\[(.+)\]/i);
      if (geoMatch) {
        result.userGeography = geoMatch[1]
          .split(',')
          .map((g) => g.trim().replace(/['"]/g, ''));
      }

      const envMatch = line.match(/^environment\s*:\s*(.+)/i);
      if (envMatch) result.environment = envMatch[1].trim().toLowerCase();
    }
  }

  return result;
}

/**
 * Extract environment and user geography signals from the diff.
 * Returns an array of plain-English signal descriptions.
 * @param {string|null} diff
 * @returns {string[]}
 */
function extractGeoSignals(diff) {
  if (!diff || typeof diff !== 'string') return [];
  const signals = new Set();

  const addedLines = diff
    .split('\n')
    .filter((l) => l.startsWith('+') && !l.startsWith('+++'))
    .join('\n');

  for (const { regex, type } of GEO_PATTERNS) {
    const re = new RegExp(regex.source, regex.flags);
    let match;
    while ((match = re.exec(addedLines)) !== null) {
      const value = (match[2] || match[1] || '').trim();
      switch (type) {
        case 'user_geo_check':
          signals.add(`User geography check: ${match[0].trim()}`);
          break;
        case 'locale_check':
          signals.add(`Locale check detected: ${value}`);
          break;
        case 'country_check':
          signals.add(`Country check detected: ${value}`);
          break;
        case 'env_geo_flag':
          signals.add(`Environment flag with geo/compliance scope: ${value}`);
          break;
        case 'feature_flag_geo':
          signals.add(`Feature flag with compliance scope: ${value}`);
          break;
        case 'consent_gate':
          signals.add('Consent gate function call detected');
          break;
        case 'geo_guard_fn':
          signals.add(`Geography guard function detected: ${match[0].trim()}`);
          break;
      }
    }
  }

  return [...signals].slice(0, 15);
}

/**
 * Build ctx.feature from ctx.pr. Never throws; on error sets safe default.
 *
 * @param {object} ctx  Pipeline context (must have ctx.pr from Stage 1)
 * @returns {Promise<object>} ctx with ctx.feature populated
 */
async function buildFeatureContext(ctx) {
  const safeDefault = {
    headline: ctx.pr?.title || '',
    branchName: null,
    ticketId: null,
    commitSummary: '',
    docSnippets: '',
    prSections: {},
    conventionWarnings: [],
    serviceDomains: [],
    lineageHints: { writes: [], reads: [], streams: [] },
    sentinelManifest: {},
    geoSignals: [],
    evidence: { branchName: false, commitMessages: false, docFiles: false, prSections: false },
    missingContext: true,
    contextQuality: 'low',
  };

  try {
    if (!ctx.pr) {
      console.warn('[feature-context] ctx.pr missing — using safe default');
      ctx.feature = safeDefault;
      return ctx;
    }

    const pr = ctx.pr;
    const headRef = pr.headRef ?? null;
    const commits = pr.commits || [];
    const files = pr.files || [];

    const { headline, ticketId } = headlineFromBranch(headRef, pr.title || '');
    const meaningful = meaningfulCommitMessages(commits);
    const commitSummary = meaningful.join('\n').slice(0, MAX_COMMIT_SUMMARY_CHARS);
    const docSnippets = buildDocSnippets(files);
    const prSections = parsePRTemplateSections(pr.description || '');

    // New enrichment signals
    const serviceDomains  = classifyServiceDomains(files);
    const lineageHints    = extractLineageHints(pr.diff || null);
    const sentinelManifest   = parseSentinelManifests(files);
    const geoSignals      = extractGeoSignals(pr.diff || null);

    const hasMeaningfulBody = (pr.description || '').trim().length >= MIN_MEANINGFUL_BODY_LENGTH;
    const hasMeaningfulCommits = meaningful.length > 0;
    const hasDocSnippets = docSnippets.length > 0;
    const hasDescriptiveBranch = !isVagueBranch(headRef);
    const hasPRSections = Object.keys(prSections).length > 0;
    const hasEnrichmentSignals =
      serviceDomains.length > 0 ||
      lineageHints.writes.length > 0 ||
      lineageHints.reads.length > 0 ||
      Object.keys(sentinelManifest).length > 0 ||
      geoSignals.length > 0;

    const signalCount = [
      hasMeaningfulBody, hasMeaningfulCommits, hasDocSnippets,
      hasDescriptiveBranch, hasPRSections, hasEnrichmentSignals,
    ].filter(Boolean).length;
    const contextQuality = signalCount >= 3 ? 'high' : signalCount >= 1 ? 'medium' : 'low';

    const missingContext =
      !hasMeaningfulBody && !hasMeaningfulCommits && !hasDocSnippets &&
      !hasDescriptiveBranch && !hasPRSections && !hasEnrichmentSignals;

    // Convention checks — flag missing structured information without changing verdict
    const conventionWarnings = [];
    if (!prSections.jurisdictions && !hasMeaningfulBody && geoSignals.length === 0) {
      conventionWarnings.push('Add a "Jurisdictions" section to the PR description (e.g. "## Jurisdictions\nCalifornia, EU")');
    }
    if (!prSections.featureSummary && !hasMeaningfulBody) {
      conventionWarnings.push('Add a "## Feature Summary" section explaining what this PR does and why');
    }
    if (!prSections.dataTouched && !hasDocSnippets && lineageHints.writes.length === 0 && lineageHints.reads.length === 0) {
      conventionWarnings.push('Add a "## Data Touched" section listing any databases, PII fields, or sensitive data accessed');
    }

    if (conventionWarnings.length > 0) {
      console.warn(`[feature-context] Convention warnings (${conventionWarnings.length}):`, conventionWarnings);
    }

    ctx.feature = {
      headline: headline || pr.title || '',
      branchName: headRef,
      ticketId,
      commitSummary,
      docSnippets,
      prSections,
      conventionWarnings,
      serviceDomains,
      lineageHints,
      sentinelManifest,
      geoSignals,
      evidence: {
        branchName: hasDescriptiveBranch,
        commitMessages: hasMeaningfulCommits,
        docFiles: hasDocSnippets,
        prSections: hasPRSections,
        enrichmentSignals: hasEnrichmentSignals,
      },
      missingContext,
      contextQuality,
    };

    if (missingContext) {
      console.warn('[feature-context] Missing context — no meaningful body, commits, docs, descriptive branch, PR sections, or enrichment signals');
    }
    if (ticketId) {
      console.log(`[feature-context] Ticket ID extracted from branch: ${ticketId}`);
    }
    if (serviceDomains.length > 0) {
      console.log(`[feature-context] Service domains detected: ${serviceDomains.join(', ')}`);
    }
    if (lineageHints.writes.length > 0 || lineageHints.reads.length > 0) {
      console.log(`[feature-context] Lineage hints — writes: [${lineageHints.writes.join(', ')}] reads: [${lineageHints.reads.join(', ')}]`);
    }
    if (lineageHints.streams.length > 0) {
      console.log(`[feature-context] Stream topics: ${lineageHints.streams.join(', ')}`);
    }
    if (Object.keys(sentinelManifest).length > 0) {
      console.log(`[feature-context] argus.yaml manifest: ${JSON.stringify(sentinelManifest)}`);
    }
    if (geoSignals.length > 0) {
      console.log(`[feature-context] Geography signals (${geoSignals.length}): ${geoSignals[0]}…`);
    }
    console.log(`[feature-context] contextQuality: ${ctx.feature.contextQuality} | missingContext: ${ctx.feature.missingContext}`);
    console.log('[feature-context] Feature context enrichment complete ✓');
  } catch (err) {
    console.error('[feature-context] Error building feature context:', err.message);
    ctx.feature = safeDefault;
  }

  return ctx;
}

module.exports = { buildFeatureContext };
