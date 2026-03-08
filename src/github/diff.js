'use strict';

const GITHUB_API = 'https://api.github.com';

// Hard cap on diff content sent to OpenAI — avoids token blowout on huge PRs.
// At ~4 chars/token this is roughly 1,500 tokens of diff context.
const MAX_DIFF_CHARS = 6000;

/**
 * Fetch the list of changed files + patches for a PR from the GitHub API.
 * Returns a trimmed plaintext summary suitable for inclusion in an LLM prompt.
 *
 * @param {string} token     Installation access token
 * @param {string} owner     Repo owner login
 * @param {string} repo      Repo name
 * @param {number} prNumber  Pull request number
 * @returns {Promise<{ summary: string, files: object[] }>}
 */
async function fetchPRDiff(token, owner, repo, prNumber) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}/files?per_page=30`;

  const response = await fetch(url, {
    headers: {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'User-Agent': 'Sentinel-Security-Bot/1.0',
    },
  });

  if (!response.ok) {
    const body = await response.text();
    throw new Error(`[diff] fetchPRDiff failed (${response.status}): ${body}`);
  }

  const files = await response.json();

  // Build a compact plaintext diff summary
  const parts = [];
  let totalChars = 0;

  for (const file of files) {
    if (totalChars >= MAX_DIFF_CHARS) {
      parts.push(`\n[...${files.length - parts.length} more files truncated]`);
      break;
    }

    const header = `### ${file.status.toUpperCase()}: ${file.filename} (+${file.additions}/-${file.deletions})`;
    const patch  = file.patch || '(binary or no patch available)';

    // Truncate individual file patches to avoid one huge file eating everything
    const trimmedPatch = patch.length > 2000 ? patch.slice(0, 2000) + '\n[...truncated]' : patch;
    const block = `${header}\n\`\`\`diff\n${trimmedPatch}\n\`\`\``;

    totalChars += block.length;
    parts.push(block);
  }

  const summary = parts.join('\n\n');

  console.log(`[diff] Fetched ${files.length} changed file(s) — ${summary.length} chars of diff`);

  return { summary, files };
}

module.exports = { fetchPRDiff };
