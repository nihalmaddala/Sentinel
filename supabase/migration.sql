-- ══════════════════════════════════════════════════════════════════════════════
-- Argus — Full Schema Migration
-- Run this in the Supabase SQL editor (or via supabase db push)
-- ══════════════════════════════════════════════════════════════════════════════

-- ── Verdicts ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS verdicts (
  id                    UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  pr_number             INTEGER NOT NULL,
  pr_title              TEXT,
  pr_user               TEXT,
  repo                  TEXT,
  owner                 TEXT,
  sha                   TEXT,
  jurisdictions         JSONB    DEFAULT '[]',
  task_type             TEXT,
  risk_indicators       JSONB    DEFAULT '[]',
  models_mentioned      JSONB    DEFAULT '[]',
  intent_summary        TEXT,
  decision              TEXT     NOT NULL,
  overall_score         NUMERIC(4,3),
  legal_risk            NUMERIC(4,3),
  arch_exposure         NUMERIC(4,3),
  reasoning             TEXT,
  citations             JSONB    DEFAULT '[]',
  recommendations       JSONB    DEFAULT '[]',
  jurisdiction_breakdown JSONB   DEFAULT '[]',
  graph_paths           JSONB    DEFAULT '[]',
  sensitive_data        JSONB    DEFAULT '[]',
  graph_risk_level      TEXT,
  verdict_source        TEXT,
  enforced_at           TIMESTAMPTZ DEFAULT now(),
  created_at            TIMESTAMPTZ DEFAULT now()
);

-- ── Issues ────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS issues (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  verdict_id   UUID REFERENCES verdicts(id) ON DELETE SET NULL,
  issue_id     TEXT UNIQUE,
  title        TEXT,
  description  TEXT,
  severity     TEXT,
  status       TEXT,
  regulation   TEXT,
  source_file  TEXT,
  pr_number    TEXT,
  repository   TEXT,
  todos        JSONB DEFAULT '[]',
  reports      JSONB DEFAULT '[]',
  created_at   TIMESTAMPTZ DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- Infrastructure Lineage Graph — replaces Neo4j
-- ══════════════════════════════════════════════════════════════════════════════

-- ── graph_models ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS graph_models (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name            TEXT UNIQUE NOT NULL,
  task            TEXT,
  risk_level      TEXT,
  version         TEXT,
  framework       TEXT,
  description     TEXT,
  discovered_from TEXT DEFAULT 'seed',
  first_seen_pr   INTEGER,
  last_seen_pr    INTEGER,
  created_at      TIMESTAMPTZ DEFAULT now(),
  updated_at      TIMESTAMPTZ DEFAULT now()
);

-- ── graph_databases ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS graph_databases (
  id               UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name             TEXT UNIQUE NOT NULL,
  region           TEXT,
  encryption       TEXT,
  compliance_scope TEXT,
  description      TEXT,
  discovered_from  TEXT DEFAULT 'seed',
  first_seen_pr    INTEGER,
  last_seen_pr     INTEGER,
  created_at       TIMESTAMPTZ DEFAULT now(),
  updated_at       TIMESTAMPTZ DEFAULT now()
);

-- ── graph_data_properties ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS graph_data_properties (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name        TEXT UNIQUE NOT NULL,
  type        TEXT,  -- PII | Biometric | Behavioral | Financial | Anonymized
  sensitivity TEXT,  -- Critical | High | Medium | Low
  regulation  TEXT,
  created_at  TIMESTAMPTZ DEFAULT now()
);

-- ── graph_model_db_edges ──────────────────────────────────────────────────────
-- Replaces WRITES_TO / READS_FROM Neo4j edges
CREATE TABLE IF NOT EXISTS graph_model_db_edges (
  id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  model_name   TEXT NOT NULL,
  db_name      TEXT NOT NULL,
  direction    TEXT NOT NULL CHECK (direction IN ('reads', 'writes')),
  data_flow    TEXT,
  created_at   TIMESTAMPTZ DEFAULT now(),
  UNIQUE (model_name, db_name, direction)
);

-- ── graph_db_property_edges ───────────────────────────────────────────────────
-- Replaces CONTAINS Neo4j edges
CREATE TABLE IF NOT EXISTS graph_db_property_edges (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  db_name       TEXT NOT NULL,
  property_name TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now(),
  UNIQUE (db_name, property_name)
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_verdicts_pr       ON verdicts(pr_number, repo, owner);
CREATE INDEX IF NOT EXISTS idx_verdicts_decision ON verdicts(decision);
CREATE INDEX IF NOT EXISTS idx_issues_status     ON issues(status);
CREATE INDEX IF NOT EXISTS idx_graph_models_name ON graph_models(name);
CREATE INDEX IF NOT EXISTS idx_graph_dbs_region  ON graph_databases(region);
CREATE INDEX IF NOT EXISTS idx_model_db_edges    ON graph_model_db_edges(model_name);
CREATE INDEX IF NOT EXISTS idx_db_prop_edges     ON graph_db_property_edges(db_name);
