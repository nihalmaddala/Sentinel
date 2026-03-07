'use strict';

// Runner script — reads seed.cypher and executes against Neo4j

const path  = require('path');
const fs    = require('fs');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const neo4j = require('neo4j-driver');

async function seed() {
  const uri      = process.env.NEO4J_URI;
  const username = process.env.NEO4J_USERNAME;
  const password = process.env.NEO4J_PASSWORD;

  if (!uri || !username || !password) {
    console.error('[seed] FATAL: NEO4J_URI, NEO4J_USERNAME, NEO4J_PASSWORD must be set in .env');
    process.exit(1);
  }

  const driver = neo4j.driver(uri, neo4j.auth.basic(username, password));

  try {
    await driver.verifyConnectivity();
    console.log('[seed] Connected to Neo4j:', uri);
  } catch (err) {
    console.error('[seed] Cannot connect to Neo4j:', err.message);
    await driver.close();
    process.exit(1);
  }

  const cypherPath = path.resolve(__dirname, './seed.cypher');
  const rawCypher  = fs.readFileSync(cypherPath, 'utf8');

  // Strip comments — keep all CREATE clauses as ONE query so variable
  // references (auth, face, etc.) remain in scope within a single transaction.
  const singleQuery = rawCypher
    .split('\n')
    .filter((l) => l.trim() && !l.trim().startsWith('//'))
    .join('\n');

  const session = driver.session({ defaultAccessMode: neo4j.session.WRITE });

  try {
    console.log('[seed] Clearing existing graph data...');
    await session.run('MATCH (n) DETACH DELETE n');
    console.log('[seed] Graph cleared');

    console.log('[seed] Running seed as a single Cypher transaction...');
    await session.run(singleQuery);
    console.log('[seed] Seed query executed');

    const nodeResult = await session.run(
      'MATCH (n) RETURN labels(n)[0] AS type, count(n) AS count ORDER BY type'
    );
    console.log('\n[seed] Graph contents:');
    nodeResult.records
      .filter((r) => r.get('type') !== null)
      .forEach((r) => console.log('  ' + r.get('type') + ': ' + r.get('count') + ' node(s)'));

    const relResult = await session.run(
      'MATCH ()-[r]->() RETURN type(r) AS type, count(r) AS count ORDER BY type'
    );
    console.log('[seed] Relationships:');
    relResult.records.forEach((r) => {
      console.log('  ' + r.get('type') + ': ' + r.get('count') + ' edge(s)');
    });
  } finally {
    await session.close();
    await driver.close();
  }

  console.log('\n[seed] Neo4j seed complete');
}

seed().catch((err) => {
  console.error('[seed] FATAL:', err.message);
  process.exit(1);
});
