-- ══════════════════════════════════════════════════════════════════════════════
-- Sentinel — Schema Migration
-- Two tables only: scans (one row per PR) + contributor_stats (view)
-- Run this in the Supabase SQL editor
-- ══════════════════════════════════════════════════════════════════════════════

-- ── scans ─────────────────────────────────────────────────────────────────────
-- One row per pull request scanned. Drives the PR feed and contributor tabs.
CREATE TABLE IF NOT EXISTS scans (
  id               UUID        PRIMARY KEY DEFAULT gen_random_uuid(),

  -- PR identity
  pr_number        INTEGER     NOT NULL,
  pr_title         TEXT        NOT NULL,
  author           TEXT        NOT NULL,
  repo             TEXT        NOT NULL,
  owner            TEXT        NOT NULL,
  sha              TEXT,

  -- Verdict
  status           TEXT        NOT NULL CHECK (status IN ('MERGED', 'BLOCKED', 'ESC_HUMAN')),
  summary          TEXT,                        -- plain-English explanation for the dashboard
  attack_type      TEXT,                        -- null if clean
  attack_succeeded BOOLEAN     NOT NULL DEFAULT FALSE,
  defense_held     BOOLEAN     NOT NULL DEFAULT TRUE,

  -- Raw injection evidence (stored for the detail panel)
  pattern_matches  JSONB       NOT NULL DEFAULT '[]',
  probe_results    JSONB       NOT NULL DEFAULT '{}',
  recommendations  JSONB       NOT NULL DEFAULT '[]',

  scanned_at       TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ── Indexes ───────────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_scans_author     ON scans(author);
CREATE INDEX IF NOT EXISTS idx_scans_status     ON scans(status);
CREATE INDEX IF NOT EXISTS idx_scans_repo       ON scans(repo, owner);
CREATE INDEX IF NOT EXISTS idx_scans_scanned_at ON scans(scanned_at DESC);

-- ── contributor_stats view ────────────────────────────────────────────────────
-- Aggregates per-author reputation data used by the Contributors tab.
CREATE OR REPLACE VIEW contributor_stats AS
SELECT
  author,
  COUNT(*)                                                         AS total,
  COUNT(*) FILTER (WHERE status = 'BLOCKED')                       AS blocked,
  COUNT(*) FILTER (WHERE status = 'MERGED')                        AS merged,
  COUNT(*) FILTER (WHERE attack_succeeded = TRUE)                  AS attacks_succeeded,
  ROUND(
    COUNT(*) FILTER (WHERE status = 'BLOCKED')::NUMERIC
    / NULLIF(COUNT(*), 0) * 100
  )                                                                AS block_pct,
  MAX(scanned_at)                                                  AS last_seen
FROM scans
GROUP BY author
ORDER BY blocked DESC, total DESC;
