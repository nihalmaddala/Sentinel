'use strict';

const jwt = require('jsonwebtoken');
const config = require('../config');

const GITHUB_API = 'https://api.github.com';

/**
 * Build a GitHub App JWT valid for 10 minutes.
 * GitHub requires iat to be backdated 60s to account for clock drift.
 */
function buildAppJwt() {
  const now = Math.floor(Date.now() / 1000);
  return jwt.sign(
    {
      iat: now - 60,
      exp: now + 600, // 10 minutes
      iss: config.github.appId,
    },
    config.github.privateKey,
    { algorithm: 'RS256' }
  );
}

/**
 * Exchange the App JWT for a short-lived installation access token.
 * The token is valid for 1 hour and scoped to the installation.
 *
 * @param {number|string} installationId
 * @returns {Promise<string>} installation access token
 */
async function getInstallationToken(installationId) {
  const appJwt = buildAppJwt();

  const response = await fetch(
    `${GITHUB_API}/app/installations/${installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${appJwt}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
        'User-Agent': 'Sentinel-Security-Bot/1.0',
      },
    }
  );

  if (!response.ok) {
    const body = await response.text();
    throw new Error(
      `[auth] Failed to get installation token (${response.status}): ${body}`
    );
  }

  const data = await response.json();
  return data.token;
}

module.exports = { buildAppJwt, getInstallationToken };
