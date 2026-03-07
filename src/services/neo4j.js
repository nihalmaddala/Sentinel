'use strict';

const neo4j = require('neo4j-driver');
const config = require('../config');

let driver = null;

if (config.neo4j.uri && config.neo4j.username && config.neo4j.password) {
  driver = neo4j.driver(
    config.neo4j.uri,
    neo4j.auth.basic(config.neo4j.username, config.neo4j.password),
    {
      maxConnectionLifetime: 30 * 60 * 1000,     // 30 min — shorter than Aura's idle kill
      maxConnectionPoolSize: 10,
      connectionAcquisitionTimeout: 30 * 1000,    // 30s to acquire a connection
      connectionTimeout: 30 * 1000,               // 30s to establish
      logging: neo4j.logging.console('warn'),
    }
  );

  // Verify connectivity at startup — non-fatal if it fails
  driver
    .verifyConnectivity()
    .then(() => console.log('[neo4j] Connected to', config.neo4j.uri))
    .catch((err) => {
      console.warn('[neo4j] Connectivity check failed (trace stage will degrade):', err.message);
    });
} else {
  console.warn('[neo4j] No credentials — trace stage will return placeholder data');
}

/**
 * Run a Cypher query and return the raw records array.
 * Always resolves — returns [] on error or when driver is unavailable.
 *
 * @param {string} cypher
 * @param {object} params
 * @returns {Promise<import('neo4j-driver').Record[]>}
 */
async function runQuery(cypher, params = {}, retries = 2) {
  if (!driver) {
    console.warn('[neo4j] runQuery called but driver is null — returning []');
    return [];
  }

  const session = driver.session({ defaultAccessMode: neo4j.session.READ });
  try {
    const result = await session.run(cypher, params);
    return result.records;
  } catch (err) {
    console.error('[neo4j] Query error:', err.message);
    if (retries > 0 && (err.code === 'SessionExpired' || err.code === 'ServiceUnavailable')) {
      console.log(`[neo4j] Retrying query (${retries} attempts left)…`);
      await session.close();
      await new Promise((r) => setTimeout(r, 1000));
      return runQuery(cypher, params, retries - 1);
    }
    return [];
  } finally {
    await session.close();
  }
}

/**
 * Run a write Cypher statement (CREATE / MERGE / SET).
 * Always resolves — returns false on error or when driver is unavailable.
 *
 * @param {string} cypher
 * @param {object} params
 * @returns {Promise<boolean>} true on success, false on failure
 */
async function writeQuery(cypher, params = {}) {
  if (!driver) {
    console.warn('[neo4j] writeQuery called but driver is null — skipping');
    return false;
  }

  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });
  try {
    await session.run(cypher, params);
    return true;
  } catch (err) {
    console.error('[neo4j] Write error:', err.message);
    return false;
  } finally {
    await session.close();
  }
}

module.exports = { driver, runQuery, writeQuery };
