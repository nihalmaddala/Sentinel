'use strict';

// Stage 4: Trace — query infrastructure lineage graph in Supabase

const { getClient } = require('../services/supabase');

/**
 * Stage 4 — Trace
 * Queries the Neo4j infrastructure lineage graph to determine whether
 * the PR's models or task type are connected to sensitive data stores.
 *
 * Populates ctx.graphEvidence with:
 *   pathsFound    — human-readable lineage path descriptions
 *   sensitiveData — list of sensitive DataProperty types found
 *   databases     — databases the model touches
 *   riskLevel     — 'Critical' | 'High' | 'Medium' | 'Low' | 'None'
 *   cyperPaths    — raw Neo4j results (for detailed display)
 */

// Risk level scoring based on data sensitivity
const RISK_SCORES = {
  Biometric:  4,
  PII:        3,
  Behavioral: 2,
  Financial:  2,
  Anonymized: 0,
};

function scoreToRiskLevel(score) {
  if (score >= 4) return 'Critical';
  if (score >= 3) return 'High';
  if (score >= 2) return 'Medium';
  if (score >= 1) return 'Low';
  return 'None';
}

/**
 * Fuzzy name match — returns true if either string contains the other (case-insensitive).
 * Bridges "DynamicPricing" ↔ "DynamicPricing_v1".
 */
function fuzzyMatch(a, b) {
  const al = a.toLowerCase();
  const bl = b.toLowerCase();
  return al.includes(bl) || bl.includes(al);
}

/**
 * Stage 4 — Trace
 * Queries the Supabase graph tables to determine whether the PR's models
 * or task type are connected to sensitive data stores.
 *
 * Populates ctx.graphEvidence with:
 *   pathsFound    — human-readable lineage path descriptions
 *   sensitiveData — list of sensitive DataProperty types found
 *   databases     — databases the model touches
 *   riskLevel     — 'Critical' | 'High' | 'Medium' | 'Low' | 'None'
 *   totalPaths    — count of lineage paths
 */
async function trace(ctx) {
  console.log('[trace] Stage 4 — Trace starting…');

  const { intent, jurisdictions } = ctx;
  const modelNames   = intent?.modelsMentioned || [];
  const taskType     = intent?.taskType        || '';
  const jurisRegions = jurisdictions           || [];

  const supabase = getClient();

  if (!supabase) {
    console.warn('[trace] Supabase not configured — using static fallback');
    ctx.graphEvidence = buildStaticEvidence(modelNames, taskType, jurisRegions);
    console.log('[trace] Stage 4 complete (degraded) ✓');
    return ctx;
  }

  // ── Load full graph from Supabase (small enough to load once) ───────────────
  const [
    { data: allModels   },
    { data: allDbs      },
    { data: allProps    },
    { data: modelEdges  },
    { data: dbPropEdges },
  ] = await Promise.all([
    supabase.from('graph_models').select('*'),
    supabase.from('graph_databases').select('*'),
    supabase.from('graph_data_properties').select('*'),
    supabase.from('graph_model_db_edges').select('*'),
    supabase.from('graph_db_property_edges').select('*'),
  ]);

  const dbByName   = Object.fromEntries((allDbs   || []).map(d => [d.name, d]));
  const propByName = Object.fromEntries((allProps || []).map(p => [p.name, p]));

  // ── Resolve relevant model names (fuzzy) ────────────────────────────────────
  const relevantModelNames = new Set();

  for (const name of modelNames) {
    for (const m of (allModels || [])) {
      if (fuzzyMatch(name, m.name)) relevantModelNames.add(m.name);
    }
  }

  // Fall back to task-type match if no direct model hit
  if (relevantModelNames.size === 0 && taskType && taskType !== 'Unknown') {
    for (const m of (allModels || [])) {
      if (m.task && fuzzyMatch(taskType, m.task)) relevantModelNames.add(m.name);
    }
  }

  if (relevantModelNames.size > 0) {
    console.log(`[trace] Resolved models from graph: ${[...relevantModelNames].join(', ')}`);
  }

  const pathsFound    = new Set();
  const sensitiveData = new Set();
  const databases     = new Set();
  const graphRegions  = new Set();
  let maxScore        = 0;

  const REGION_TO_JURISDICTION = {
    California: 'California',
    EU:         'EU',
    UK:         'UK',
    Illinois:   'Illinois',
    'New York': 'New York',
    Texas:      'Texas',
  };

  // ── Query 1: Model → DB → DataProperty paths ────────────────────────────────
  for (const modelName of relevantModelNames) {
    const edges = (modelEdges || []).filter(e => e.model_name === modelName);

    for (const edge of edges) {
      const db = dbByName[edge.db_name];
      if (!db) continue;

      const propEdges = (dbPropEdges || []).filter(e => e.db_name === db.name);
      for (const pe of propEdges) {
        const prop = propByName[pe.property_name];
        if (!prop || !['Biometric', 'PII', 'Behavioral', 'Financial'].includes(prop.type)) continue;

        sensitiveData.add(prop.type);
        databases.add(`${db.name} (${db.region || 'unknown'})`);
        if (db.region && REGION_TO_JURISDICTION[db.region]) {
          graphRegions.add(REGION_TO_JURISDICTION[db.region]);
        }
        const score = RISK_SCORES[prop.type] || 1;
        if (score > maxScore) maxScore = score;
        pathsFound.add(`${modelName} → ${db.name} [${db.region || '?'}] → ${prop.name} (${prop.type})`);
      }
    }
  }

  // ── Query 2: Region scan for jurisdiction-specific databases ─────────────────
  const jurisdictionRegionMap = { California: 'California', EU: 'EU', UK: 'UK' };
  for (const jurisdiction of jurisRegions) {
    const region = jurisdictionRegionMap[jurisdiction];
    if (!region) continue;

    console.log(`[trace] Scanning region-sensitive databases for: ${region}`);
    const regionDbs = (allDbs || []).filter(d => d.region === region);

    for (const db of regionDbs) {
      const connectedModels = (modelEdges || [])
        .filter(e => e.db_name === db.name)
        .map(e => e.model_name);
      const relevant = connectedModels.filter(m => relevantModelNames.has(m));
      if (relevant.length === 0) continue;

      const propEdges = (dbPropEdges || []).filter(e => e.db_name === db.name);
      for (const pe of propEdges) {
        const prop = propByName[pe.property_name];
        if (!prop || !['Biometric', 'PII', 'Behavioral', 'Financial'].includes(prop.type)) continue;

        sensitiveData.add(prop.type);
        databases.add(`${db.name} (${db.region})`);
        if (REGION_TO_JURISDICTION[db.region]) graphRegions.add(REGION_TO_JURISDICTION[db.region]);
        const score = RISK_SCORES[prop.type] || 1;
        if (score > maxScore) maxScore = score;
        pathsFound.add(`${relevant.join(', ')} → ${db.name} [${db.region}] → ${prop.name} (${prop.type})`);
      }
    }
  }

  // ── Feed graph-discovered regions back into ctx.jurisdictions ────────────────
  if (graphRegions.size > 0 && ctx.jurisdictions) {
    const before = [...ctx.jurisdictions];
    const merged = [...new Set([
      ...ctx.jurisdictions.filter(j => j !== 'Global'),
      ...[...graphRegions],
    ])];
    if (merged.length > 0) {
      ctx.jurisdictions = merged;
      const added = merged.filter(j => !before.includes(j));
      if (added.length > 0) {
        console.log(`[trace] Graph evidence implicated additional jurisdictions: ${added.join(', ')}`);
      }
    }
  }

  if (pathsFound.size === 0) {
    console.warn('[trace] No graph paths found — using static fallback');
    ctx.graphEvidence = buildStaticEvidence(modelNames, taskType, jurisRegions);
    console.log('[trace] Stage 4 complete (degraded) ✓');
    return ctx;
  }

  ctx.graphEvidence = {
    pathsFound:    [...pathsFound],
    sensitiveData: [...sensitiveData],
    databases:     [...databases],
    riskLevel:     scoreToRiskLevel(maxScore),
    totalPaths:    pathsFound.size,
  };

  console.log(`[trace] Paths found: ${pathsFound.size} | Risk level: ${ctx.graphEvidence.riskLevel}`);
  console.log('[trace] Stage 4 complete ✓');
  return ctx;
}

// ── Static fallback ───────────────────────────────────────────────────────────
function buildStaticEvidence(modelNames, taskType, jurisdictions) {
  const KNOWN_LINEAGE = {
    DynamicPricing_v1:    { paths: ['DynamicPricing_v1 → UserVault [California] → Location (PII)', 'DynamicPricing_v1 → UserVault [California] → Email (PII)', 'DynamicPricing_v1 → MarketingDB [US] → BrowsingHistory (Behavioral)'], databases: ['UserVault (California)', 'MarketingDB (US)'] },
    FaceMatch_v2:         { paths: ['FaceMatch_v2 → BiometricVault [Illinois] → FaceTemplate (Biometric)', 'FaceMatch_v2 → BiometricVault [Illinois] → Biometric_Hash (Biometric)', 'FaceMatch_v2 → UserVault [California] → Email (PII)'], databases: ['BiometricVault (Illinois)', 'UserVault (California)'] },
    FraudSentinel_v3:     { paths: ['FraudSentinel_v3 → TransactionLedger [California] → CreditCardToken (Financial)', 'FraudSentinel_v3 → TransactionLedger [California] → PurchaseHistory (Behavioral)'], databases: ['TransactionLedger (California)'] },
    CreditPredict_v1:     { paths: ['CreditPredict_v1 → TransactionLedger [California] → CreditCardToken (Financial)', 'CreditPredict_v1 → UserVault [California] → CreditScore (Financial)'], databases: ['TransactionLedger (California)', 'UserVault (California)'] },
    SupportGPT_v1:        { paths: ['SupportGPT_v1 → UserVault [California] → Email (PII)', 'SupportGPT_v1 → TransactionLedger [California] → PurchaseHistory (Behavioral)'], databases: ['UserVault (California)', 'TransactionLedger (California)'] },
    AdScore_v2:           { paths: ['AdScore_v2 → MarketingDB [US] → BrowsingHistory (Behavioral)', 'AdScore_v2 → AdDataWarehouse [US] → InterestProfile (Behavioral)'], databases: ['MarketingDB (US)', 'AdDataWarehouse (US)'] },
    Llama_3_Recommender:  { paths: ['Llama_3_Recommender → PublicAnalytics [EU] → AggregateStats (Anonymized)'], databases: ['PublicAnalytics (EU)'] },
  };
  const TASK_MAP = {
    'Individualized Pricing':    'DynamicPricing_v1',
    'Facial Recognition':        'FaceMatch_v2',
    'Fraud Detection':           'FraudSentinel_v3',
    'Credit Scoring':            'CreditPredict_v1',
    'Automated Decision-Making': 'SupportGPT_v1',
    'Behavioral Profiling':      'AdScore_v2',
    'Content Recommendation':    'Llama_3_Recommender',
  };

  const allPaths = [];
  const allDbs   = new Set();

  const fuzzy = (name) => {
    const l = name.toLowerCase();
    for (const [key, val] of Object.entries(KNOWN_LINEAGE)) {
      if (key.toLowerCase().includes(l) || l.includes(key.toLowerCase())) return val;
    }
    return null;
  };

  for (const n of modelNames) {
    const lin = KNOWN_LINEAGE[n] || fuzzy(n);
    if (lin) { allPaths.push(...lin.paths); lin.databases.forEach(d => allDbs.add(d)); }
  }

  if (allPaths.length === 0) {
    const key = Object.keys(TASK_MAP).find(k =>
      k.toLowerCase().includes((taskType || '').toLowerCase()) ||
      (taskType || '').toLowerCase().includes(k.toLowerCase())
    );
    const m = key ? TASK_MAP[key] : null;
    if (m && KNOWN_LINEAGE[m]) {
      allPaths.push(...KNOWN_LINEAGE[m].paths);
      KNOWN_LINEAGE[m].databases.forEach(d => allDbs.add(d));
    }
  }

  if (allPaths.length === 0) {
    return { pathsFound: [], sensitiveData: [], databases: [], riskLevel: 'None', totalPaths: 0 };
  }

  const types = [];
  if (allPaths.some(p => p.includes('Biometric')))  types.push('Biometric');
  if (allPaths.some(p => p.includes('Financial')))  types.push('Financial');
  if (allPaths.some(p => p.includes('PII')))        types.push('PII');
  if (allPaths.some(p => p.includes('Behavioral'))) types.push('Behavioral');

  const score = types.includes('Biometric') ? 4 : types.includes('Financial') ? 3
    : types.includes('PII') ? 3 : types.includes('Behavioral') ? 2 : 0;

  return { pathsFound: allPaths, sensitiveData: types, databases: [...allDbs], riskLevel: scoreToRiskLevel(score), totalPaths: allPaths.length };
}

module.exports = { trace };
