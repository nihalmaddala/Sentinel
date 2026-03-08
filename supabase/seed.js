'use strict';

// Seed the Argus infrastructure lineage graph into Supabase.
// Mirrors the data from neo4j/seed.cypher exactly.
// Run: node supabase/seed.js

const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../.env') });

const { createClient } = require('@supabase/supabase-js');

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);

// ── Seed data (mirrors neo4j/seed.cypher) ────────────────────────────────────

const MODELS = [
  { name: 'FaceMatch_v2',         task: 'Facial Recognition',        risk_level: 'High',   version: '2.1.0', framework: 'PyTorch',     description: 'Biometric face-match for MFA and facility access' },
  { name: 'Llama_3_Recommender',  task: 'Content Recommendation',    risk_level: 'Medium', version: '3.2.0', framework: 'HuggingFace', description: 'Product & content ranking model' },
  { name: 'DynamicPricing_v1',    task: 'Individualized Pricing',    risk_level: 'High',   version: '1.4.2', framework: 'XGBoost',     description: 'Per-user price discrimination based on browsing & location' },
  { name: 'FraudSentinel_v3',     task: 'Fraud Detection',           risk_level: 'High',   version: '3.0.1', framework: 'TensorFlow',  description: 'Real-time transaction fraud scoring — auto-declines above threshold' },
  { name: 'SupportGPT_v1',        task: 'Automated Decision-Making', risk_level: 'High',   version: '1.0.0', framework: 'OpenAI',      description: 'LLM-powered refund authorization without human review' },
  { name: 'AdScore_v2',           task: 'Behavioral Profiling',      risk_level: 'Medium', version: '2.3.0', framework: 'LightGBM',   description: 'User interest scoring for ad targeting' },
  { name: 'CreditPredict_v1',     task: 'Credit Scoring',            risk_level: 'High',   version: '1.1.0', framework: 'Scikit',      description: 'Predictive credit-worthiness for BNPL checkout' },
];

const DATABASES = [
  { name: 'UserVault',        region: 'California', encryption: 'AES-256',  compliance_scope: 'CCPA',          description: 'Primary user identity & credential store' },
  { name: 'PublicAnalytics',  region: 'EU',         encryption: 'AES-256',  compliance_scope: 'GDPR',          description: 'Anonymized aggregate analytics (GDPR safe)' },
  { name: 'MarketingDB',      region: 'US',         encryption: 'None',     compliance_scope: 'Unclassified',  description: 'Ad & campaign targeting — NO encryption (!)' },
  { name: 'TransactionLedger',region: 'California', encryption: 'AES-256',  compliance_scope: 'CCPA/PCI',      description: 'Payment history, purchase records' },
  { name: 'EU_IdentityStore', region: 'EU',         encryption: 'AES-256',  compliance_scope: 'GDPR',          description: 'EU resident PII — GDPR Art.17 right-to-delete scope' },
  { name: 'BiometricVault',   region: 'Illinois',   encryption: 'AES-256',  compliance_scope: 'BIPA',          description: 'Biometric templates — Illinois BIPA regulated' },
  { name: 'AdDataWarehouse',  region: 'US',         encryption: 'TLS-only', compliance_scope: 'FTC',           description: 'Third-party ad exchange data lake' },
];

const DATA_PROPERTIES = [
  { name: 'Biometric_Hash',    type: 'Biometric',   sensitivity: 'Critical', regulation: 'BIPA §15 / GDPR Art.9' },
  { name: 'FaceTemplate',      type: 'Biometric',   sensitivity: 'Critical', regulation: 'BIPA §15 / EU AI Act Art.5' },
  { name: 'Email',             type: 'PII',         sensitivity: 'High',     regulation: 'CCPA §1798.140 / GDPR Art.4' },
  { name: 'Location',          type: 'PII',         sensitivity: 'High',     regulation: 'CCPA §1798.140 / GDPR Art.4' },
  { name: 'BrowsingHistory',   type: 'Behavioral',  sensitivity: 'Medium',   regulation: 'CCPA §7030 ADMT provisions' },
  { name: 'AggregateStats',    type: 'Anonymized',  sensitivity: 'Low',      regulation: 'None (de-identified)' },
  { name: 'CreditCardToken',   type: 'Financial',   sensitivity: 'Critical', regulation: 'PCI-DSS / CCPA' },
  { name: 'PurchaseHistory',   type: 'Behavioral',  sensitivity: 'Medium',   regulation: 'CCPA §7030' },
  { name: 'IPAddress',         type: 'PII',         sensitivity: 'Medium',   regulation: 'GDPR Art.4 / CCPA' },
  { name: 'CreditScore',       type: 'Financial',   sensitivity: 'High',     regulation: 'ECOA / FCRA / CCPA' },
  { name: 'DeviceFingerprint', type: 'PII',         sensitivity: 'High',     regulation: 'ePrivacy / CCPA' },
  { name: 'InterestProfile',   type: 'Behavioral',  sensitivity: 'Medium',   regulation: 'CCPA §7030 / GDPR Art.22' },
];

// Model → Database edges (direction: reads | writes)
const MODEL_DB_EDGES = [
  { model_name: 'FaceMatch_v2',        db_name: 'BiometricVault',    direction: 'reads',  data_flow: 'face templates for matching' },
  { model_name: 'FaceMatch_v2',        db_name: 'UserVault',         direction: 'writes', data_flow: 'match result + confidence' },
  { model_name: 'FaceMatch_v2',        db_name: 'UserVault',         direction: 'reads',  data_flow: 'user identity lookup' },
  { model_name: 'DynamicPricing_v1',   db_name: 'UserVault',         direction: 'reads',  data_flow: 'user location + profile' },
  { model_name: 'DynamicPricing_v1',   db_name: 'MarketingDB',       direction: 'reads',  data_flow: 'browsing patterns' },
  { model_name: 'DynamicPricing_v1',   db_name: 'MarketingDB',       direction: 'writes', data_flow: 'individualized prices per user' },
  { model_name: 'FraudSentinel_v3',    db_name: 'TransactionLedger', direction: 'reads',  data_flow: 'transaction history' },
  { model_name: 'FraudSentinel_v3',    db_name: 'TransactionLedger', direction: 'writes', data_flow: 'fraud score + auto-decline flag' },
  { model_name: 'CreditPredict_v1',    db_name: 'TransactionLedger', direction: 'reads',  data_flow: 'purchase & payment history' },
  { model_name: 'CreditPredict_v1',    db_name: 'UserVault',         direction: 'writes', data_flow: 'credit score + BNPL decision' },
  { model_name: 'SupportGPT_v1',       db_name: 'UserVault',         direction: 'reads',  data_flow: 'user profile + order history' },
  { model_name: 'SupportGPT_v1',       db_name: 'TransactionLedger', direction: 'reads',  data_flow: 'transaction lookup' },
  { model_name: 'SupportGPT_v1',       db_name: 'TransactionLedger', direction: 'writes', data_flow: 'refund approval/denial + reasoning' },
  { model_name: 'Llama_3_Recommender', db_name: 'PublicAnalytics',   direction: 'reads',  data_flow: 'aggregate user preferences' },
  { model_name: 'AdScore_v2',          db_name: 'MarketingDB',       direction: 'reads',  data_flow: 'browsing + purchase patterns' },
  { model_name: 'AdScore_v2',          db_name: 'AdDataWarehouse',   direction: 'writes', data_flow: 'interest profile vectors' },
];

// Database → DataProperty edges (CONTAINS)
const DB_PROPERTY_EDGES = [
  { db_name: 'UserVault',         property_name: 'Biometric_Hash' },
  { db_name: 'UserVault',         property_name: 'Email' },
  { db_name: 'UserVault',         property_name: 'Location' },
  { db_name: 'UserVault',         property_name: 'CreditScore' },
  { db_name: 'UserVault',         property_name: 'DeviceFingerprint' },
  { db_name: 'BiometricVault',    property_name: 'FaceTemplate' },
  { db_name: 'BiometricVault',    property_name: 'Biometric_Hash' },
  { db_name: 'TransactionLedger', property_name: 'CreditCardToken' },
  { db_name: 'TransactionLedger', property_name: 'PurchaseHistory' },
  { db_name: 'TransactionLedger', property_name: 'IPAddress' },
  { db_name: 'MarketingDB',       property_name: 'BrowsingHistory' },
  { db_name: 'MarketingDB',       property_name: 'Email' },
  { db_name: 'MarketingDB',       property_name: 'Location' },
  { db_name: 'EU_IdentityStore',  property_name: 'Email' },
  { db_name: 'EU_IdentityStore',  property_name: 'Location' },
  { db_name: 'EU_IdentityStore',  property_name: 'IPAddress' },
  { db_name: 'PublicAnalytics',   property_name: 'AggregateStats' },
  { db_name: 'AdDataWarehouse',   property_name: 'InterestProfile' },
  { db_name: 'AdDataWarehouse',   property_name: 'BrowsingHistory' },
  { db_name: 'AdDataWarehouse',   property_name: 'DeviceFingerprint' },
];

async function seed() {
  console.log('[seed] Connecting to Supabase…');

  if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_ROLE_KEY) {
    console.error('[seed] FATAL: SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set in .env');
    process.exit(1);
  }

  // ── Clear existing graph data ──────────────────────────────────────────────
  console.log('[seed] Clearing existing graph data…');
  for (const table of ['graph_db_property_edges', 'graph_model_db_edges', 'graph_data_properties', 'graph_databases', 'graph_models']) {
    const { error } = await supabase.from(table).delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (error) console.warn(`[seed] Warning clearing ${table}:`, error.message);
  }
  console.log('[seed] Graph tables cleared');

  // ── Insert models ──────────────────────────────────────────────────────────
  const { error: e1 } = await supabase.from('graph_models').insert(MODELS);
  if (e1) { console.error('[seed] Failed to insert models:', e1.message); process.exit(1); }
  console.log(`[seed] Inserted ${MODELS.length} model(s)`);

  // ── Insert databases ───────────────────────────────────────────────────────
  const { error: e2 } = await supabase.from('graph_databases').insert(DATABASES);
  if (e2) { console.error('[seed] Failed to insert databases:', e2.message); process.exit(1); }
  console.log(`[seed] Inserted ${DATABASES.length} database(s)`);

  // ── Insert data properties ─────────────────────────────────────────────────
  const { error: e3 } = await supabase.from('graph_data_properties').insert(DATA_PROPERTIES);
  if (e3) { console.error('[seed] Failed to insert data properties:', e3.message); process.exit(1); }
  console.log(`[seed] Inserted ${DATA_PROPERTIES.length} data property(ies)`);

  // ── Insert model→db edges ──────────────────────────────────────────────────
  const { error: e4 } = await supabase.from('graph_model_db_edges').insert(MODEL_DB_EDGES);
  if (e4) { console.error('[seed] Failed to insert model-db edges:', e4.message); process.exit(1); }
  console.log(`[seed] Inserted ${MODEL_DB_EDGES.length} model→db edge(s)`);

  // ── Insert db→property edges ───────────────────────────────────────────────
  const { error: e5 } = await supabase.from('graph_db_property_edges').insert(DB_PROPERTY_EDGES);
  if (e5) { console.error('[seed] Failed to insert db-property edges:', e5.message); process.exit(1); }
  console.log(`[seed] Inserted ${DB_PROPERTY_EDGES.length} db→property edge(s)`);

  console.log('\n[seed] ✅ Supabase graph seed complete');
}

seed().catch((err) => {
  console.error('[seed] FATAL:', err.message);
  process.exit(1);
});
