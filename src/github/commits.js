'use strict';

const GITHUB_API = 'https://api.github.com';

/**
 * Fetch the list of commits in a PR from the GitHub API.
 * Returns normalized commit objects for feature-context enrichment.
 * On failure: logs warning and returns [] (never throws).
 *
 * @param {string} token     Installation access token
 * @param {string} owner     Repo owner login
 * @param {string} repo      Repo name
 * @param {number} prNumber  Pull request number
 * @returns {Promise<Array<{ sha: string, message: string, author: string }>>}
 */
async function fetchPRCommits(token, owner, repo, prNumber) {
  const url = `${GITHUB_API}/repos/${owner}/${repo}/pulls/${prNumber}/commits?per_page=30`;

  try {
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
      console.warn(`[commits] fetchPRCommits failed (${response.status}): ${body.slice(0, 200)}`);
      return [];
    }

    const data = await response.json();
    const commits = (Array.isArray(data) ? data : []).map((c) => ({
      sha: c.sha || '',
      message: (c.commit?.message || '').trim(),
      author: c.commit?.author?.name || c.author?.login || '',
    }));

    console.log(`[commits] Fetched ${commits.length} commit(s) for PR #${prNumber}`);
    return commits;
  } catch (err) {
    console.warn('[commits] Could not fetch PR commits (continuing without them):', err.message);
    return [];
  }
}

module.exports = { fetchPRCommits };
