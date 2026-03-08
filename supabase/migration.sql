-- ══════════════════════════════════════════════════════════════════════════════
-- Sentinel — Full Reset Migration
-- Drops everything, then creates only what we need:
--   scans table  (one row per PR — author, verdict, summary)
--   contributor_stats view  (per-author block rate)
--
-- Run this in the Supabase SQL editor to get a clean slate.
-- ══════════════════════════════════════════════════════════════════════════════

-- ── 1. Wipe everything ────────────────────────────────────────────────────────
DROP VIEW  IF EXISTS contributor_stats CASCADE;
DROP TABLE IF EXISTS scans             CASCADE;

-- Legacy tables from old schema (safe to drop if they exist)
DROP TABLE IF EXISTS verdicts               CASCADE;
DROP TABLE IF EXISTS issues                 CASCADE;
DROP TABLE IF EXISTS graph_models           CASCADE;
DROP TABLE IF EXISTS graph_databases        CASCADE;
DROP TABLE IF EXISTS graph_data_properties  CASCADE;
DROP TABLE IF EXISTS graph_model_db_edges   CASCADE;
DROP TABLE IF EXISTS graph_db_property_edges CASCADE;

-- ── 2. scans ──────────────────────────────────────────────────────────────────
CREATE TABLE scans (
  id          UUID        PRIMARY KEY DEFAULT gen_random_uuid(),
  author      TEXT        NOT NULL,                -- GitHub username of the PR author
  pr_number   INTEGER     NOT NULL,
  pr_title    TEXT        NOT NULL,
  repo        TEXT        NOT NULL,                -- "owner/repo"
  status      TEXT        NOT NULL CHECK (status IN ('MERGED', 'BLOCKED')),
  summary     TEXT,                                -- plain-English reason (what was found / why clean)
  scanned_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── 3. Indexes ────────────────────────────────────────────────────────────────
CREATE INDEX idx_scans_author     ON scans(author);
CREATE INDEX idx_scans_status     ON scans(status);
CREATE INDEX idx_scans_scanned_at ON scans(scanned_at DESC);

-- ── 4. contributor_stats view ─────────────────────────────────────────────────
CREATE VIEW contributor_stats AS
SELECT
  author,
  COUNT(*)                                            AS total,
  COUNT(*) FILTER (WHERE status = 'BLOCKED')          AS blocked,
  COUNT(*) FILTER (WHERE status = 'MERGED')           AS merged,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'BLOCKED')::NUMERIC
    / NULLIF(COUNT(*), 0) * 100
  )                                                   AS block_pct,
  MAX(scanned_at)                                     AS last_seen
FROM scans
GROUP BY author
ORDER BY blocked DESC, total DESC;
