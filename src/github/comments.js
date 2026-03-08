'use strict';

const GITHUB_API = 'https://api.github.com';
const { renderInjectionReport } = require('../attacker/injection-report');

const DECISION_BADGE = {
  BLOCK:     'BLOCKED',
  ESC_HUMAN: 'NEEDS REVIEW',
  MERGE:     'APPROVED',
};

/**
 * Format the injection scan result as a PR comment and post it.
 *
 * @param {string} token       Installation access token
 * @param {string} owner       Repo owner login
 * @param {string} repo        Repo name
 * @param {number} prNumber    Pull request number
 * @param {object} ctx         Full pipeline context object
 */
async function postAuditReport(token, owner, repo, prNumber, ctx) {
  const { verdict } = ctx;
  const badge = DECISION_BADGE[verdict?.decision] || verdict?.decision || 'UNKNOWN';

  const body = [
    `## Sentinel Security Scan — ${badge}`,
    '',
    renderInjectionReport(ctx?.injectionReport),
    '',
    '---',
    '*Sentinel — Prompt Injection Detection for AI-Assisted Code Review*',
  ].join('\n');

  const response = await fetch(
    `${GITHUB_API}/repos/${owner}/${repo}/issues/${prNumber}/comments`,
    {
      method: 'POST',
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Sentinel-Security-Bot/1.0',
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
  console.log(`[comments] Report posted — comment id: ${data.id}, url: ${data.html_url}`);
  return data.html_url;
}

module.exports = { postAuditReport };
