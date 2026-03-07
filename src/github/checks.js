'use strict';

const GITHUB_API = 'https://api.github.com';

// Map Argus verdict decisions to GitHub check conclusions
const CONCLUSION_MAP = {
  MERGE: 'success',
  BLOCK: 'failure',
  ESC_HUMAN: 'action_required',
};

/**
 * Create a check run in "in_progress" state, locking the Merge button.
 *
 * @param {string} token   Installation access token
 * @param {string} owner   Repo owner login
 * @param {string} repo    Repo name
 * @param {string} sha     Head commit SHA
 * @returns {Promise<number>} checkRunId
 */
async function createPendingCheck(token, owner, repo, sha) {
  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/check-runs`,
    {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Argus-Compliance-Bot/1.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        name: 'Argus Compliance Gate',
        head_sha: sha,
        status: 'in_progress',
        started_at: new Date().toISOString(),
        output: {
          title: 'Argus is analysing this PR…',
          summary:
            'Autonomous compliance analysis in progress. Checking against EU AI Act, CCPA 2026, and infrastructure lineage graph.',
        },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`[checks] createPendingCheck failed (${response.status}): ${body}`);
  }

  const data = await response.json();
  console.log(`[checks] Pending check created — id: ${data.id}`);
  return data.id;
}

/**
 * Resolve a check run with the final verdict.
 *
 * @param {string} token        Installation access token
 * @param {string} owner        Repo owner login
 * @param {string} repo         Repo name
 * @param {number} checkRunId   Check run ID from createPendingCheck
 * @param {object} verdict      Pipeline verdict object (from Stage 5)
 * @param {Array}  [annotations] Optional code-line annotations to display in the diff
 */
async function updateCheck(token, owner, repo, checkRunId, verdict, annotations = []) {
  const conclusion = CONCLUSION_MAP[verdict.decision] || 'neutral';
  const confPct    = verdict.confidence !== undefined ? `${((verdict.confidence || 0) * 100).toFixed(0)}%` : 'N/A';

  // Use the structured prSummary if available, fall back to legacy reasoning
  const headline  = verdict.prSummary?.headline  || `Argus Verdict: ${verdict.decision}`;
  const reasoning = verdict.prSummary?.reasoning || verdict.reasoning || '';

  const summaryLines = [
    `**Decision: ${verdict.decision}**`,
    `**Overall Risk:** ${((verdict.overallScore || 0) * 100).toFixed(0)}%  |  **Legal Risk:** ${((verdict.legalRisk || 0) * 100).toFixed(0)}%  |  **Architectural Exposure:** ${((verdict.architecturalExposure || 0) * 100).toFixed(0)}%  |  **Confidence:** ${confPct}`,
    '',
    reasoning,
    verdict.confidenceRationale ? `_${verdict.confidenceRationale}_` : '',
  ].filter(Boolean);

  if (verdict.recommendations?.length > 0) {
    summaryLines.push('', '**Required Actions:**');
    verdict.recommendations.forEach((r) => summaryLines.push(`- ${r}`));
  }

  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/check-runs/${checkRunId}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Argus-Compliance-Bot/1.0',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        status: 'completed',
        conclusion,
        completed_at: new Date().toISOString(),
        output: {
          title: headline,
          summary: summaryLines.join('\n'),
          ...(annotations.length > 0 && { annotations: annotations.slice(0, 50) }),
        },
      }),
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`[checks] updateCheck failed (${response.status}): ${body}`);
  }

  console.log(`[checks] Check ${checkRunId} resolved → ${conclusion}`);
}

/**
 * Fetch the list of files changed in a pull request.
 * Returns an empty array if the call fails (non-fatal).
 *
 * @param {string} token     Installation access token
 * @param {string} owner     Repo owner login
 * @param {string} repo      Repo name
 * @param {number} prNumber  Pull request number
 * @returns {Promise<Array>} Array of GitHub pull-request file objects
 */
async function getPRFiles(token, owner, repo, prNumber) {
  try {
    const response = await fetch(
      `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=30`,
      {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'Argus-Compliance-Bot/1.0',
        },
      }
    );
    if (!response.ok) return [];
    return await response.json();
  } catch {
    return [];
  }
}

/**
 * Extract the first line number added/changed in a unified diff patch string.
 * e.g. "@@ -0,0 +1,20 @@" → 1
 *
 * @param {string|undefined} patch
 * @returns {number}
 */
function firstChangedLine(patch) {
  if (!patch) return 1;
  const match = patch.match(/@@ -\d+(?:,\d+)? \+(\d+)/);
  return match ? parseInt(match[1], 10) : 1;
}

/**
 * Parse a unified diff patch into an ordered list of added/modified lines
 * with their new-file line numbers.
 *
 * Only "+" lines (additions) are included — context and removed lines are
 * tracked only to advance the counter correctly.
 *
 * @param {string|undefined} patch  Unified diff patch string
 * @returns {Array<{line: number, content: string}>}
 */
function parsePatchLines(patch) {
  if (!patch) return [];
  const result = [];
  let currentLine = 0;

  for (const raw of patch.split('\n')) {
    // Hunk header: @@ -a,b +c,d @@ — resets the new-file line counter
    const hunkMatch = raw.match(/^@@ -\d+(?:,\d+)? \+(\d+)/);
    if (hunkMatch) {
      currentLine = parseInt(hunkMatch[1], 10);
      continue;
    }
    if (raw.startsWith('-')) {
      // Removed line — does not advance the new-file counter
      continue;
    }
    if (raw.startsWith('+')) {
      // Added/modified line — record it (strip leading "+")
      result.push({ line: currentLine, content: raw.slice(1) });
      currentLine++;
    } else {
      // Context line (unchanged) — advances counter but not recorded
      currentLine++;
    }
  }
  return result;
}

/**
 * Find the line number in a parsed patch that best matches a code snippet
 * from the LLM's violation output.
 *
 * Uses a three-tier matching strategy:
 *   1. Exact substring match (most reliable)
 *   2. Case-insensitive substring match
 *   3. Longest-identifier token match (catches paraphrased snippets)
 *
 * @param {string} snippet      Verbatim code fragment from the LLM
 * @param {Array<{line: number, content: string}>} patchLines
 * @returns {{ startLine: number, endLine: number } | null}
 */
function findSnippetInPatch(snippet, patchLines) {
  if (!snippet || !patchLines.length) return null;

  const needle = snippet.trim();
  if (!needle) return null;

  // Tier 1: exact substring match
  for (const entry of patchLines) {
    if (entry.content.includes(needle)) {
      return { startLine: entry.line, endLine: entry.line };
    }
  }

  // Tier 2: case-insensitive substring match
  const lowerNeedle = needle.toLowerCase();
  for (const entry of patchLines) {
    if (entry.content.toLowerCase().includes(lowerNeedle)) {
      return { startLine: entry.line, endLine: entry.line };
    }
  }

  // Tier 3: match on the longest identifier token (function/variable names)
  const tokens = needle
    .split(/[\s().,:;={}[\]'"!&|?+\-*/\\<>@#%^~`]+/)
    .filter((t) => t.length > 3);
  tokens.sort((a, b) => b.length - a.length); // longest first — most distinctive

  for (const token of tokens.slice(0, 3)) {
    for (const entry of patchLines) {
      if (entry.content.includes(token)) {
        return { startLine: entry.line, endLine: entry.line };
      }
    }
  }

  return null; // no match found — caller should fall back to firstChangedLine
}

/**
 * Build GitHub Checks API annotation objects from the pipeline verdict
 * and the PR's changed files.
 *
 * Uses a two-path strategy:
 *   Path A (LLM-targeted): If verdict.violations is non-empty, each violation
 *     is matched to the exact line in the diff using parsePatchLines +
 *     findSnippetInPatch. Annotations are per-violation with specific titles
 *     and explanations (e.g. "California CCPA §7030").
 *   Path B (fallback): If no violations were identified, falls back to the
 *     original behaviour — one generic annotation on the first changed line
 *     of each changed file.
 *
 * @param {string}   token     Installation access token
 * @param {string}   owner     Repo owner
 * @param {string}   repo      Repo name
 * @param {number}   prNumber  PR number
 * @param {object}   verdict   Pipeline verdict from Stage 5
 * @param {Array}    [prFiles] Pre-fetched PR file objects (avoids a redundant API call)
 * @returns {Promise<Array>}   Array of annotation objects (max 50 per GitHub limit)
 */
async function buildAnnotations(token, owner, repo, prNumber, verdict, prFiles) {
  if (verdict.decision === 'MERGE') return [];

  const files = (prFiles && prFiles.length > 0)
    ? prFiles
    : await getPRFiles(token, owner, repo, prNumber);

  if (!files || files.length === 0) {
    console.warn('[checks] No PR files retrieved — annotations skipped');
    return [];
  }

  const level     = verdict.decision === 'BLOCK' ? 'failure' : 'warning';
  const fileMap   = new Map(files.map((f) => [f.filename, f]));
  const annotations = [];

  // ── Path 1: violatingCode — precise per-file/line annotations ───────────────
  // Use the specific code locations the LLM identified, if available.
  if (verdict.violatingCode?.length > 0) {
    for (const v of verdict.violatingCode) {
      const prFile = fileMap.get(v.file) || [...fileMap.values()].find(
        (f) => f.filename.endsWith(v.file) || v.file.endsWith(f.filename)
      );
      if (!prFile || prFile.status === 'removed') continue;

      // Parse line range "45–52" or "45" or "45-52"
      const lineMatch = (v.lines || '').match(/(\d+)/);
      const startLine = lineMatch ? parseInt(lineMatch[1], 10) : firstChangedLine(prFile.patch);

      const citationText = v.regulation
        ? `\n\nApplicable: ${v.regulation}`
        : '';

      annotations.push({
        path:             prFile.filename,
        start_line:       startLine,
        end_line:         startLine,
        annotation_level: level,
        title:            `Argus — ${v.severity || verdict.decision}: ${(v.issue || '').slice(0, 60)}`,
        message:          `${v.issue || 'Compliance violation detected.'}${citationText}`,
      });

      if (annotations.length >= 50) break;
    }
  }

  // ── Path 2: fallback — one annotation per changed file ──────────────────────
  // Used when violatingCode is empty (deterministic fallback verdict, etc.)
  if (annotations.length === 0) {
    const jurisdictionLines = (verdict.jurisdictionBreakdown || [])
      .filter((j) => j.decision === 'BLOCK' || j.decision === 'ESC_HUMAN')
      .map((j) => `• [${j.jurisdiction}] ${j.decision}: ${j.reason}`);

    const firstCit = verdict.citations?.[0];
    const citText  = firstCit
      ? `\n\nCitation: ${typeof firstCit === 'string' ? firstCit.slice(0, 200) : (firstCit.law || '') + (firstCit.excerpt ? ` — "${firstCit.excerpt}"` : '')}`
      : '';

    const baseMessage = jurisdictionLines.length > 0
      ? jurisdictionLines.join('\n') + citText
      : (verdict.prSummary?.reasoning || verdict.reasoning || 'Compliance violation detected.') + citText;

    for (const file of files.slice(0, 10)) {
      if (file.status === 'removed') continue;
      annotations.push({
        path:             file.filename,
        start_line:       firstChangedLine(file.patch),
        end_line:         firstChangedLine(file.patch),
        annotation_level: level,
        title:            `Argus Compliance Gate — ${verdict.decision}`,
        message:          baseMessage,
      });
    }
  }

  console.log(`[checks] Built ${annotations.length} annotation(s) for PR #${prNumber} (Path B fallback)`);
  return annotations.slice(0, 50);
}

module.exports = { createPendingCheck, updateCheck, getPRFiles, buildAnnotations, parsePatchLines, findSnippetInPatch };
