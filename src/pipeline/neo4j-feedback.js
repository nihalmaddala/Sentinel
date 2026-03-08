'use strict';

// Feedback Loop — writes newly discovered models, databases, and data flows
// back into the Supabase graph tables after each PR analysis.
// Uses upsert throughout so all writes are idempotent.

const { getClient } = require('../services/supabase');

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
  const prNumber    = ctx.pr?.number                   || 0;
  const prTitle     = ctx.pr?.title                    || '';

  const hasModels   = models.length > 0;
  const hasSources  = dataSources.length > 0;
  const hasManifest = manifest && (manifest.dataTags?.length > 0 || manifest.userGeography?.length > 0);

  if (!hasModels && !hasSources && !hasManifest) {
    console.log('[feedback] No discoverable entities in this PR — skipping graph write-back');
    return;
  }

  const supabase = getClient();
  if (!supabase) {
    console.warn('[feedback] Supabase not configured — skipping graph write-back');
    return;
  }

  console.log(`[feedback] Writing PR #${prNumber} discoveries to Supabase graph…`);
  let written = 0;

  // ── 1. Upsert Model nodes ───────────────────────────────────────────────────
  for (const name of models) {
    const { error } = await supabase.from('graph_models').upsert(
      { name, task: taskType || 'Unknown', discovered_from: 'pr', first_seen_pr: prNumber, last_seen_pr: prNumber, updated_at: new Date().toISOString() },
      { onConflict: 'name', ignoreDuplicates: false }
    );
    if (!error) { console.log(`[feedback] Upserted Model: ${name}`); written++; }
    else console.warn(`[feedback] Model upsert failed (${name}):`, error.message);
  }

  // ── 2. Upsert Database nodes ────────────────────────────────────────────────
  const inferredRegion = manifest?.userGeography?.[0] || null;
  for (const name of dataSources) {
    const { error } = await supabase.from('graph_databases').upsert(
      { name, region: inferredRegion, discovered_from: 'pr', first_seen_pr: prNumber, last_seen_pr: prNumber, updated_at: new Date().toISOString() },
      { onConflict: 'name', ignoreDuplicates: false }
    );
    if (!error) { console.log(`[feedback] Upserted Database: ${name}`); written++; }
    else console.warn(`[feedback] Database upsert failed (${name}):`, error.message);
  }

  // ── 3. Upsert model→db edges from lineageHints ─────────────────────────────
  for (const modelName of models) {
    for (const dbName of (lineage.reads || [])) {
      const { error } = await supabase.from('graph_model_db_edges').upsert(
        { model_name: modelName, db_name: dbName, direction: 'reads' },
        { onConflict: 'model_name,db_name,direction', ignoreDuplicates: true }
      );
      if (!error) { console.log(`[feedback] Upserted READS: ${modelName} → ${dbName}`); written++; }
    }
    for (const dbName of (lineage.writes || [])) {
      const { error } = await supabase.from('graph_model_db_edges').upsert(
        { model_name: modelName, db_name: dbName, direction: 'writes' },
        { onConflict: 'model_name,db_name,direction', ignoreDuplicates: true }
      );
      if (!error) { console.log(`[feedback] Upserted WRITES: ${modelName} → ${dbName}`); written++; }
    }
  }

  // ── 4. Upsert DataProperty nodes + db→property edges from argus.yaml ────────
  if (manifest?.dataTags?.length > 0 && dataSources.length > 0) {
    for (const tag of manifest.dataTags) {
      const mapping = DATA_TAG_TYPE_MAP[tag.toLowerCase()];
      if (!mapping) continue;
      const propName = `${mapping.type}_from_manifest`;

      await supabase.from('graph_data_properties').upsert(
        { name: propName, type: mapping.type, sensitivity: mapping.sensitivity },
        { onConflict: 'name', ignoreDuplicates: true }
      );

      for (const dbName of dataSources) {
        const { error } = await supabase.from('graph_db_property_edges').upsert(
          { db_name: dbName, property_name: propName },
          { onConflict: 'db_name,property_name', ignoreDuplicates: true }
        );
        if (!error) { console.log(`[feedback] Upserted CONTAINS: ${dbName} → ${propName}`); written++; }
      }
    }
  }

  console.log(`[feedback] Supabase write-back complete — ${written} operations for PR #${prNumber} ("${prTitle.slice(0, 50)}")`);
}

module.exports = { feedbackLoop };
