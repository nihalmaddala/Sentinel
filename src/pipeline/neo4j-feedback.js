'use strict';

// Neo4j Feedback Loop — writes newly discovered models, databases, and data flows
// back into the graph after each PR analysis so future traces are more accurate.
//
// Uses MERGE throughout so all writes are idempotent (safe to run repeatedly).
// ON CREATE SET is used for properties that should not overwrite curated seed data.

const { writeQuery } = require('../services/neo4j');

// Maps argus.yaml data_types tags → DataProperty.type values used in the graph
const DATA_TAG_TYPE_MAP = {
  pii:                 { type: 'PII',        sensitivity: 'High' },
  biometric:           { type: 'Biometric',  sensitivity: 'Critical' },
  health:              { type: 'PII',        sensitivity: 'High' },
  financial:           { type: 'Financial',  sensitivity: 'High' },
  behavioral:          { type: 'Behavioral', sensitivity: 'Medium' },
  location:            { type: 'PII',        sensitivity: 'High' },
  precise_geolocation: { type: 'PII',        sensitivity: 'High' },
  children:            { type: 'PII',        sensitivity: 'Critical' },
  sensitive:           { type: 'PII',        sensitivity: 'High' },
  anonymized:          { type: 'Anonymized', sensitivity: 'Low' },
};

/**
 * Neo4j Feedback Loop — Stage 8 (fire-and-forget)
 *
 * Writes newly discovered graph nodes and edges back to Neo4j based on what
 * Argus learned from processing the PR. Runs after the pipeline completes so
 * it never blocks the verdict or the GitHub response.
 *
 * Discovers and writes:
 *   - Model nodes (from ctx.intent.modelsMentioned)
 *   - Database nodes (from ctx.intent.dataSourcesMentioned)
 *   - READS_FROM / WRITES_TO edges (from ctx.feature.lineageHints)
 *   - DataProperty nodes + CONTAINS edges (from ctx.feature.argusManifest.dataTags)
 *   - Service nodes + INVOKES edges (from ctx.feature.serviceDomains)
 *
 * @param {object} ctx  Final pipeline context (all stages complete)
 */
async function feedbackLoop(ctx) {
  const models      = ctx.intent?.modelsMentioned      || [];
  const dataSources = ctx.intent?.dataSourcesMentioned || [];
  const taskType    = ctx.intent?.taskType             || null;
  const manifest    = ctx.feature?.argusManifest       || null;
  const lineage     = ctx.feature?.lineageHints        || {};
  const domains     = ctx.feature?.serviceDomains      || [];
  const prNumber    = ctx.pr?.number                   || 0;
  const prTitle     = ctx.pr?.title                    || '';

  // Nothing to discover — skip entirely
  const hasModels   = models.length > 0;
  const hasSources  = dataSources.length > 0;
  const hasManifest = manifest && (manifest.dataTags?.length > 0 || manifest.userGeography?.length > 0);

  if (!hasModels && !hasSources && !hasManifest) {
    console.log('[feedback] No discoverable entities in this PR — skipping Neo4j write-back');
    return;
  }

  console.log(`[feedback] Writing PR #${prNumber} discoveries to Neo4j graph…`);

  let written = 0;

  // ── 1. Merge Model nodes ────────────────────────────────────────────────────
  for (const name of models) {
    const ok = await writeQuery(
      `MERGE (m:Model {name: $name})
       ON CREATE SET m.task            = $task,
                     m.discovered_from = 'pr',
                     m.first_seen_pr   = $prNumber,
                     m.created_at      = timestamp()
       ON MATCH  SET m.last_seen_pr    = $prNumber,
                     m.updated_at      = timestamp()`,
      { name, task: taskType || 'Unknown', prNumber }
    );
    if (ok) {
      console.log(`[feedback] Merged Model: ${name}`);
      written++;
    }
  }

  // ── 2. Merge Database nodes ─────────────────────────────────────────────────
  // If argus.yaml declares user_geography, use the first entry as the region
  // (ON CREATE only — never overwrite curated seed data).
  const inferredRegion = manifest?.userGeography?.[0] || null;

  for (const name of dataSources) {
    const ok = await writeQuery(
      `MERGE (db:Database {name: $name})
       ON CREATE SET db.region          = $region,
                     db.discovered_from = 'pr',
                     db.first_seen_pr   = $prNumber,
                     db.created_at      = timestamp()
       ON MATCH  SET db.last_seen_pr    = $prNumber,
                     db.updated_at      = timestamp()`,
      { name, region: inferredRegion, prNumber }
    );
    if (ok) {
      console.log(`[feedback] Merged Database: ${name}`);
      written++;
    }
  }

  // ── 3. Merge data flow edges from lineageHints ──────────────────────────────
  // lineage.reads / lineage.writes contain database names extracted from code
  // patterns (ORM calls, raw SQL, Kafka topics) by Stage 0.
  for (const modelName of models) {
    for (const dbName of (lineage.reads || [])) {
      const ok = await writeQuery(
        `MERGE (m:Model {name: $modelName})
         MERGE (db:Database {name: $dbName})
         MERGE (m)-[:READS_FROM]->(db)`,
        { modelName, dbName }
      );
      if (ok) {
        console.log(`[feedback] Merged READS_FROM: ${modelName} → ${dbName}`);
        written++;
      }
    }

    for (const dbName of (lineage.writes || [])) {
      const ok = await writeQuery(
        `MERGE (m:Model {name: $modelName})
         MERGE (db:Database {name: $dbName})
         MERGE (m)-[:WRITES_TO]->(db)`,
        { modelName, dbName }
      );
      if (ok) {
        console.log(`[feedback] Merged WRITES_TO: ${modelName} → ${dbName}`);
        written++;
      }
    }
  }

  // ── 4. Ingest argus.yaml manifest — DataProperty nodes + CONTAINS edges ─────
  // When a developer explicitly declares data_types in argus.yaml, that's the
  // highest-quality signal we have. Create DataProperty nodes and link them to
  // every database discovered in this PR.
  if (manifest?.dataTags?.length > 0 && dataSources.length > 0) {
    for (const tag of manifest.dataTags) {
      const mapping = DATA_TAG_TYPE_MAP[tag.toLowerCase()];
      if (!mapping) continue;

      // Name the property after the tag (e.g. "pii" → "PII_from_manifest")
      // to distinguish auto-discovered properties from curated seed ones.
      const propName = `${mapping.type}_from_manifest`;

      for (const dbName of dataSources) {
        const ok = await writeQuery(
          `MERGE (dp:DataProperty {name: $propName})
           ON CREATE SET dp.type            = $type,
                         dp.sensitivity     = $sensitivity,
                         dp.discovered_from = 'argus_yaml',
                         dp.created_at      = timestamp()
           WITH dp
           MERGE (db:Database {name: $dbName})
           MERGE (db)-[:CONTAINS]->(dp)`,
          { propName, type: mapping.type, sensitivity: mapping.sensitivity, dbName }
        );
        if (ok) {
          console.log(`[feedback] Merged CONTAINS: ${dbName} → ${propName} (${mapping.type})`);
          written++;
        }
      }
    }
  }

  // ── 5. Merge Service nodes + INVOKES edges from service domains ─────────────
  // Stage 0 classifies which service domain the PR touches (e.g. "payments").
  // Create a Service node for each domain and link it to any discovered models.
  if (domains.length > 0 && models.length > 0) {
    for (const domain of domains) {
      // Capitalise first letter for consistent naming (payments → Payments)
      const serviceName = domain.charAt(0).toUpperCase() + domain.slice(1);

      for (const modelName of models) {
        const ok = await writeQuery(
          `MERGE (s:Service {name: $serviceName})
           ON CREATE SET s.discovered_from = 'pr',
                         s.first_seen_pr   = $prNumber,
                         s.created_at      = timestamp()
           WITH s
           MERGE (m:Model {name: $modelName})
           MERGE (s)-[:INVOKES]->(m)`,
          { serviceName, modelName, prNumber }
        );
        if (ok) {
          console.log(`[feedback] Merged INVOKES: ${serviceName} → ${modelName}`);
          written++;
        }
      }
    }
  }

  console.log(`[feedback] Neo4j write-back complete — ${written} node/edge operations for PR #${prNumber} ("${prTitle}")`);
}

module.exports = { feedbackLoop };
