'use strict';

// Stage 4: Neo4j — query infra lineage graph for PII/biometric hot-spots

const { runQuery } = require('../services/neo4j');

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
  Biometric: 4,
  PII:       3,
  Behavioral:2,
  Financial: 2,
  Anonymized:0,
};

/**
 * Derive a risk level label from accumulated score.
 */
function scoreToRiskLevel(score) {
  if (score >= 4) return 'Critical';
  if (score >= 3) return 'High';
  if (score >= 2) return 'Medium';
  if (score >= 1) return 'Low';
  return 'None';
}

/**
 * Run Neo4j queries for model names extracted from Stage 2 intent,
 * plus a task-type based query if no explicit model names were found.
 *
 * @param {object} ctx  Pipeline context (needs ctx.intent, ctx.jurisdictions)
 * @returns {Promise<object>} ctx with ctx.graphEvidence populated
 */
async function trace(ctx) {
  console.log('[trace] Stage 4 — Trace starting…');

  const { intent, jurisdictions } = ctx;
  const modelNames    = intent?.modelsMentioned      || [];
  const dataSources   = intent?.dataSourcesMentioned || [];
  const taskType      = intent?.taskType             || '';
  const jurisRegions  = jurisdictions || [];

  // ── Query 1: By explicit model name (fuzzy — case-insensitive CONTAINS) ────
  // A PR might mention "DynamicPricing" while Neo4j stores "DynamicPricing_v1".
  // We normalise both sides to lowercase and use CONTAINS to bridge the gap.
  const LINEAGE_BY_MODEL = `
    MATCH (m:Model)
    WHERE toLower(m.name) CONTAINS toLower($modelName)
       OR toLower($modelName) CONTAINS toLower(m.name)
    WITH m
    MATCH (m)-[:WRITES_TO|READS_FROM*1..5]->(db:Database)-[:CONTAINS]->(p:DataProperty)
    RETURN m.name AS model, db.name AS database, db.region AS region,
           p.name AS dataProperty, p.type AS dataType, p.sensitivity AS sensitivity
  `;

  // ── Query 2: By task type (fuzzy — case-insensitive CONTAINS) ───────────────
  const LINEAGE_BY_TASK = `
    MATCH (m:Model)
    WHERE toLower(m.task) CONTAINS toLower($task)
       OR toLower($task) CONTAINS toLower(m.task)
    WITH m
    MATCH (m)-[:WRITES_TO|READS_FROM*1..5]->(db:Database)-[:CONTAINS]->(p:DataProperty)
    RETURN m.name AS model, db.name AS database, db.region AS region,
           p.name AS dataProperty, p.type AS dataType, p.sensitivity AS sensitivity
  `;

  // ── Query 3: Region-specific risk scan ──────────────────────────────────────
  // Check if California or EU databases contain sensitive data
  const REGION_RISK_QUERY = `
    MATCH (db:Database {region: $region})-[:CONTAINS]->(p:DataProperty)
    WHERE p.type IN ['Biometric', 'PII', 'Financial']
    OPTIONAL MATCH (m:Model)-[:WRITES_TO|READS_FROM]->(db)
    RETURN db.name AS database, db.region AS region,
           p.name AS dataProperty, p.type AS dataType,
           collect(DISTINCT m.name) AS connectedModels
  `;

  // Two separate record arrays — each query type returns different columns
  const lineageRecords = [];  // from LINEAGE_BY_MODEL / LINEAGE_BY_TASK
  const regionRecords  = [];  // from REGION_RISK_QUERY

  // Run model-name queries
  for (const modelName of modelNames) {
    console.log(`[trace] Querying lineage for model (fuzzy): ${modelName}`);
    const records = await runQuery(LINEAGE_BY_MODEL, { modelName });
    lineageRecords.push(...records);
  }

  // Run task-type query if we have a task type
  if (taskType && taskType !== 'Unknown') {
    console.log(`[trace] Querying lineage by task type (fuzzy): ${taskType}`);
    const records = await runQuery(LINEAGE_BY_TASK, { task: taskType });
    lineageRecords.push(...records);
  }

  // Run region risk scan for jurisdiction-specific databases
  const jurisdictionRegionMap = {
    California: 'California',
    EU:         'EU',
    UK:         'UK',
  };

  for (const jurisdiction of jurisRegions) {
    const region = jurisdictionRegionMap[jurisdiction];
    if (region) {
      console.log(`[trace] Scanning region-sensitive databases for: ${region}`);
      const records = await runQuery(REGION_RISK_QUERY, { region });
      regionRecords.push(...records);
    }
  }

  const allEmpty = lineageRecords.length === 0 && regionRecords.length === 0;

  // ── No Neo4j results — use static fallback based on known seed data ──────────
  if (allEmpty) {
    console.warn('[trace] Neo4j returned no records — using seed-data static fallback');
    ctx.graphEvidence = buildStaticEvidence(modelNames, taskType, jurisRegions);

    // Even in degraded mode, extract implied regions from the static paths and
    // feed them back into ctx.jurisdictions for downstream stages.
    const REGION_TO_JURISDICTION = {
      'California': 'California', 'EU': 'EU', 'UK': 'UK',
      'Illinois': 'Illinois', 'New York': 'New York', 'Texas': 'Texas',
    };
    const staticRegions = new Set();
    for (const path of ctx.graphEvidence.pathsFound) {
      const m = path.match(/\[([^\]]+)\]/);
      if (m && REGION_TO_JURISDICTION[m[1]]) staticRegions.add(REGION_TO_JURISDICTION[m[1]]);
    }
    if (staticRegions.size > 0 && ctx.jurisdictions) {
      const merged = [...new Set([
        ...ctx.jurisdictions.filter((j) => j !== 'Global'),
        ...[...staticRegions],
      ])];
      if (merged.length > 0) {
        const added = merged.filter((j) => !ctx.jurisdictions.includes(j));
        ctx.jurisdictions = merged;
        if (added.length > 0) {
          console.log(`[trace] Static evidence implicated jurisdictions: ${added.join(', ')}`);
        }
      }
    }

    console.log('[trace] Stage 4 complete (degraded) ✓');
    return ctx;
  }

  // ── Parse Neo4j records ──────────────────────────────────────────────────────
  const pathsFound    = new Set();
  const sensitiveData = new Set();
  const databases     = new Set();
  const graphRegions  = new Set();  // regions found in the actual graph data
  let maxScore        = 0;

  // Region label → canonical jurisdiction name (mirrors Stage 1 keyword map)
  const REGION_TO_JURISDICTION = {
    'California': 'California',
    'EU':         'EU',
    'UK':         'UK',
    'Illinois':   'Illinois',
    'New York':   'New York',
    'Texas':      'Texas',
  };

  // Parse lineage records (cols: model, database, region, dataProperty, dataType, sensitivity)
  for (const record of lineageRecords) {
    const model    = record.get('model')        || 'UnknownModel';
    const db       = record.get('database')     || 'UnknownDB';
    const region   = record.get('region')       || '';
    const dataProp = record.get('dataProperty') || '';
    const dataType = record.get('dataType')     || '';

    databases.add(`${db} (${region})`);
    if (region && REGION_TO_JURISDICTION[region]) graphRegions.add(REGION_TO_JURISDICTION[region]);

    if (dataType && ['Biometric', 'PII', 'Behavioral', 'Financial'].includes(dataType)) {
      sensitiveData.add(dataType);
      const score = RISK_SCORES[dataType] || 1;
      if (score > maxScore) maxScore = score;
      pathsFound.add(`${model} → ${db} [${region}] → ${dataProp} (${dataType})`);
    }
  }

  // Collect model names confirmed relevant to this PR (from lineage query results)
  const relevantModels = new Set();
  for (const record of lineageRecords) {
    const model = record.get('model');
    if (model) relevantModels.add(model);
  }
  for (const m of modelNames) {
    relevantModels.add(m);
  }

  // Parse region records (cols: database, region, dataProperty, dataType, connectedModels)
  // Only include paths where a PR-relevant model actually connects to the database.
  // This prevents showing unrelated models (FaceMatch_v2, CreditPredict_v1, etc.)
  // that happen to share the same database but aren't part of this PR's data flow.
  for (const record of regionRecords) {
    const db              = record.get('database')        || 'UnknownDB';
    const region          = record.get('region')          || '';
    const dataProp        = record.get('dataProperty')    || '';
    const dataType        = record.get('dataType')        || '';
    const connectedModels = (record.get('connectedModels') || []).filter(Boolean);

    // Skip databases where no model connects at all (avoids phantom "UnknownModel" paths)
    if (connectedModels.length === 0) continue;

    // Only include this path if one of the PR's relevant models touches this database
    const relevant = connectedModels.filter((m) => relevantModels.has(m));
    if (relevant.length === 0) continue;

    databases.add(`${db} (${region})`);
    if (region && REGION_TO_JURISDICTION[region]) graphRegions.add(REGION_TO_JURISDICTION[region]);

    if (dataType && ['Biometric', 'PII', 'Behavioral', 'Financial'].includes(dataType)) {
      sensitiveData.add(dataType);
      const score = RISK_SCORES[dataType] || 1;
      if (score > maxScore) maxScore = score;
      const modelLabel = relevant.join(', ');
      pathsFound.add(`${modelLabel} → ${db} [${region}] → ${dataProp} (${dataType})`);
    }
  }

  // ── Feed graph-discovered regions back into ctx.jurisdictions ────────────────
  // This is the autonomous path: if the graph proves UserVault [California] is
  // touched, California is implicated regardless of what the PR body said.
  if (graphRegions.size > 0 && ctx.jurisdictions) {
    const before = [...ctx.jurisdictions];
    const merged = [...new Set([
      ...ctx.jurisdictions.filter((j) => j !== 'Global'),
      ...[...graphRegions],
    ])];
    if (merged.length > 0) {
      ctx.jurisdictions = merged;
      const added = merged.filter((j) => !before.includes(j));
      if (added.length > 0) {
        console.log(`[trace] Graph evidence implicated additional jurisdictions: ${added.join(', ')}`);
      }
    }
  }

  ctx.graphEvidence = {
    pathsFound:    [...pathsFound],
    sensitiveData: [...sensitiveData],
    databases:     [...databases],
    riskLevel:     scoreToRiskLevel(maxScore),
    totalPaths:    pathsFound.size,
  };

  // Count paths that came from feedback-loop-discovered nodes (marked with discovered_from = 'pr')
  const discoveredPaths = [...pathsFound].filter((p) => {
    return lineageRecords.some((r) => {
      const model = r.get('model') || '';
      return p.startsWith(model) && !['DynamicPricing_v1','FaceMatch_v2','FraudSentinel_v3',
        'CreditPredict_v1','SupportGPT_v1','AdScore_v2','Llama_3_Recommender'].includes(model);
    });
  });

  console.log(`[trace] Paths found: ${pathsFound.size} | Risk level: ${ctx.graphEvidence.riskLevel}` +
    (discoveredPaths.length > 0 ? ` | ${discoveredPaths.length} from feedback-discovered nodes` : ''));
  console.log('[trace] Stage 4 complete ✓');
  return ctx;
}

/**
 * Static fallback based on the known seed.cypher graph structure.
 * Used when Neo4j is unreachable or returns no records.
 * We reason from what we know — "DynamicPricing_v1 reads UserVault
 * which contains PII/Location in California."
 */
function buildStaticEvidence(modelNames, taskType, jurisdictions) {
  const KNOWN_LINEAGE = {
    DynamicPricing_v1: {
      paths: [
        'DynamicPricing_v1 → UserVault [California] → Location (PII)',
        'DynamicPricing_v1 → UserVault [California] → Email (PII)',
        'DynamicPricing_v1 → UserVault [California] → DeviceFingerprint (PII)',
        'DynamicPricing_v1 → MarketingDB [US] → BrowsingHistory (Behavioral)',
        'DynamicPricing_v1 → MarketingDB [US] → Email (PII)',
        'DynamicPricing_v1 → MarketingDB [US] → Location (PII)',
      ],
      databases: ['UserVault (California)', 'MarketingDB (US)'],
      note: 'MarketingDB has encryption: None — PII stored unencrypted',
    },
    FaceMatch_v2: {
      paths: [
        'FaceMatch_v2 → BiometricVault [Illinois] → FaceTemplate (Biometric)',
        'FaceMatch_v2 → BiometricVault [Illinois] → Biometric_Hash (Biometric)',
        'FaceMatch_v2 → UserVault [California] → Biometric_Hash (Biometric)',
        'FaceMatch_v2 → UserVault [California] → Email (PII)',
        'FaceMatch_v2 → UserVault [California] → DeviceFingerprint (PII)',
      ],
      databases: ['BiometricVault (Illinois)', 'UserVault (California)'],
      note: 'Cross-jurisdiction biometric sync: Illinois BIPA → California CCPA',
    },
    FraudSentinel_v3: {
      paths: [
        'FraudSentinel_v3 → TransactionLedger [California] → CreditCardToken (Financial)',
        'FraudSentinel_v3 → TransactionLedger [California] → PurchaseHistory (Behavioral)',
        'FraudSentinel_v3 → TransactionLedger [California] → IPAddress (PII)',
      ],
      databases: ['TransactionLedger (California)'],
      note: 'Auto-decline without human review — CCPA ADMT disclosure required',
    },
    CreditPredict_v1: {
      paths: [
        'CreditPredict_v1 → TransactionLedger [California] → CreditCardToken (Financial)',
        'CreditPredict_v1 → TransactionLedger [California] → PurchaseHistory (Behavioral)',
        'CreditPredict_v1 → UserVault [California] → CreditScore (Financial)',
      ],
      databases: ['TransactionLedger (California)', 'UserVault (California)'],
      note: 'AI credit scoring on CA residents — ECOA/FCRA/CCPA triple exposure',
    },
    SupportGPT_v1: {
      paths: [
        'SupportGPT_v1 → UserVault [California] → Email (PII)',
        'SupportGPT_v1 → UserVault [California] → Location (PII)',
        'SupportGPT_v1 → TransactionLedger [California] → PurchaseHistory (Behavioral)',
        'SupportGPT_v1 → TransactionLedger [California] → CreditCardToken (Financial)',
      ],
      databases: ['UserVault (California)', 'TransactionLedger (California)'],
      note: 'LLM autonomous refund decisions — no human-in-the-loop',
    },
    AdScore_v2: {
      paths: [
        'AdScore_v2 → MarketingDB [US] → BrowsingHistory (Behavioral)',
        'AdScore_v2 → AdDataWarehouse [US] → InterestProfile (Behavioral)',
        'AdScore_v2 → AdDataWarehouse [US] → DeviceFingerprint (PII)',
      ],
      databases: ['MarketingDB (US)', 'AdDataWarehouse (US)'],
      note: 'Behavioral profiling synced to ad exchange — ePrivacy/CCPA risk',
    },
    Llama_3_Recommender: {
      paths: [
        'Llama_3_Recommender → PublicAnalytics [EU] → AggregateStats (Anonymized)',
      ],
      databases: ['PublicAnalytics (EU)'],
      note: 'Clean path — anonymized data only',
    },
  };

  const TASK_LINEAGE = {
    'Individualized Pricing':   'DynamicPricing_v1',
    'Facial Recognition':       'FaceMatch_v2',
    'Fraud Detection':          'FraudSentinel_v3',
    'Credit Scoring':           'CreditPredict_v1',
    'Automated Decision-Making':'SupportGPT_v1',
    'Behavioral Profiling':     'AdScore_v2',
    'Content Recommendation':   'Llama_3_Recommender',
  };

  let allPaths = [];
  let allDatabases = new Set();

  // Fuzzy key resolver: find KNOWN_LINEAGE entries where either side
  // contains the other (case-insensitive). E.g. "DynamicPricing" matches
  // "DynamicPricing_v1", and "dynamic_pricing_v1" matches "DynamicPricing_v1".
  function fuzzyFindLineage(name) {
    const lower = name.toLowerCase();
    for (const [key, lineage] of Object.entries(KNOWN_LINEAGE)) {
      const keyLower = key.toLowerCase();
      if (keyLower.includes(lower) || lower.includes(keyLower)) {
        return lineage;
      }
    }
    return null;
  }

  for (const modelName of modelNames) {
    const lineage = KNOWN_LINEAGE[modelName] || fuzzyFindLineage(modelName);
    if (lineage) {
      allPaths.push(...lineage.paths);
      lineage.databases.forEach((d) => allDatabases.add(d));
    }
  }

  // Fuzzy task type resolver for TASK_LINEAGE
  function fuzzyFindTaskModel(task) {
    const lower = task.toLowerCase();
    for (const [key, model] of Object.entries(TASK_LINEAGE)) {
      if (key.toLowerCase().includes(lower) || lower.includes(key.toLowerCase())) {
        return model;
      }
    }
    return null;
  }

  if (allPaths.length === 0) {
    const matchedModel = TASK_LINEAGE[taskType] || fuzzyFindTaskModel(taskType);
    if (matchedModel) {
      const lineage = KNOWN_LINEAGE[matchedModel];
      if (lineage) {
        allPaths = lineage.paths;
        lineage.databases.forEach((d) => allDatabases.add(d));
      }
    }
  }

  if (allPaths.length === 0) {
    return {
      pathsFound: [],
      sensitiveData: [],
      databases: [],
      riskLevel: 'None',
      totalPaths: 0,
    };
  }

  const sensitiveTypes = [];
  if (allPaths.some((p) => p.includes('Biometric')))  sensitiveTypes.push('Biometric');
  if (allPaths.some((p) => p.includes('Financial')))  sensitiveTypes.push('Financial');
  if (allPaths.some((p) => p.includes('PII')))        sensitiveTypes.push('PII');
  if (allPaths.some((p) => p.includes('Behavioral'))) sensitiveTypes.push('Behavioral');

  const maxScore = sensitiveTypes.includes('Biometric') ? 4
    : sensitiveTypes.includes('Financial') ? 3
    : sensitiveTypes.includes('PII') ? 3
    : sensitiveTypes.includes('Behavioral') ? 2 : 0;

  return {
    pathsFound: allPaths,
    sensitiveData: sensitiveTypes,
    databases: [...allDatabases],
    riskLevel: scoreToRiskLevel(maxScore),
    totalPaths: allPaths.length,
  };
}

module.exports = { trace };
