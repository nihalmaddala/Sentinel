'use strict';

/**
 * Stage 1 — Intercept
 * Parses the raw GitHub webhook payload and extracts:
 *   ctx.pr          — normalised PR metadata
 *   ctx.jurisdictions — array of detected/declared jurisdiction strings
 *
 * Jurisdiction detection uses two strategies (in priority order):
 *  1. Explicit declaration: PR body contains "Jurisdiction: California, EU"
 *  2. Keyword scan: scans title + body for known jurisdiction markers
 */

// Jurisdiction keyword map: marker → canonical name
const JURISDICTION_PATTERNS = [
  { regex: /\b(california|ccpa|admt|cpra)\b/i, name: 'California' },
  { regex: /\b(eu|gdpr|eu\s*ai\s*act|european\s*union)\b/i, name: 'EU' },
  { regex: /\b(uk|ico|uk\s*gdpr)\b/i, name: 'UK' },
  { regex: /\b(new\s*york|nypa|nydfs)\b/i, name: 'New York' },
  { regex: /\b(illinois|biipa|bipa)\b/i, name: 'Illinois' },
  { regex: /\b(texas|tdpsa)\b/i, name: 'Texas' },
  { regex: /\b(canada|pipeda|cppa|quebec\s*law\s*25|law\s*25)\b/i, name: 'Canada' },
  { regex: /\b(australia|privacy\s*act\s*1988|oaic|acrn|aus)\b/i, name: 'Australia' },
  { regex: /\b(brazil|lgpd|anpd)\b/i, name: 'Brazil' },
];

/**
 * Detect jurisdictions from PR text.
 * First checks for explicit "Jurisdiction: X, Y" declaration,
 * then falls back to keyword scanning.
 *
 * @param {string} text  Combined PR title + body
 * @returns {string[]}   Deduplicated array of jurisdiction names
 */
function detectJurisdictions(text) {
  // Strategy 1: explicit declaration "Jurisdiction: California, EU"
  const explicitMatch = text.match(/jurisdiction[s]?\s*[:\-]\s*([^\n]+)/i);
  if (explicitMatch) {
    const declared = explicitMatch[1]
      .split(/[,;]+/)
      .map((s) => s.trim())
      .filter(Boolean);
    if (declared.length > 0) {
      console.log('[intercept] Explicit jurisdictions declared:', declared);
      return [...new Set(declared)];
    }
  }

  // Strategy 2: keyword scan
  const found = [];
  for (const { regex, name } of JURISDICTION_PATTERNS) {
    if (regex.test(text) && !found.includes(name)) {
      found.push(name);
    }
  }

  if (found.length > 0) {
    console.log('[intercept] Jurisdictions detected by keyword scan:', found);
  } else {
    // No jurisdiction signals found in the PR text. Default to California + EU —
    // the two strictest regulatory regimes globally. This ensures that a plain
    // PR with no location keywords still gets checked against the most relevant
    // laws. Stage 2 will refine this further based on task type inference.
    console.warn('[intercept] No jurisdiction signals in PR — defaulting to ["California", "EU"] for maximum coverage');
    found.push('California', 'EU');
  }

  return found;
}

/**
 * Run Stage 1: Intercept.
 * Mutates and returns the pipeline context object.
 *
 * @param {object} ctx     Pipeline context (may be empty on entry)
 * @param {object} payload Raw GitHub pull_request webhook payload
 * @returns {object}       ctx with .pr and .jurisdictions populated
 */
function intercept(ctx, payload) {
  console.log('[intercept] Stage 1 — Intercept starting…');

  const { pull_request: pr, repository, installation } = payload;

  if (!pr || !repository) {
    throw new Error('[intercept] Invalid payload: missing pull_request or repository');
  }

  const combinedText = `${pr.title || ''}\n${pr.body || ''}`;

  ctx.pr = {
    id:          pr.id,
    number:      pr.number,
    title:       pr.title || '',
    description: pr.body  || '',
    diff:        payload._diff || null,
    sha:         pr.head.sha,
    repo:        repository.name,
    owner:       repository.owner.login,
    user:        pr.user?.login || 'unknown',
    installationId: installation?.id || null,
    headRef:     pr.head?.ref ?? null,
    baseRef:     pr.base?.ref ?? null,
    commits:     payload._commits || [],
    files:       payload._files  || [],
  };

  ctx.jurisdictions = detectJurisdictions(combinedText);

  console.log(`[intercept] PR #${ctx.pr.number}: "${ctx.pr.title}"`);
  console.log(`[intercept] Jurisdictions: ${ctx.jurisdictions.join(', ')}`);
  console.log(`[intercept] Code diff: ${ctx.pr.diff ? `${ctx.pr.diff.length} chars` : 'not available'}`);
  console.log('[intercept] Stage 1 complete ✓');

  return ctx;
}

module.exports = { intercept, detectJurisdictions };
