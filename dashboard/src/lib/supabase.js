import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ── Scans ─────────────────────────────────────────────────────────────────────

/**
 * Fetch all PR scans ordered newest-first.
 * Maps Supabase rows to the shape SecurityDashboard expects.
 */
export async function fetchScans() {
  const { data, error } = await supabase
    .from('scans')
    .select('*')
    .order('scanned_at', { ascending: false });
  if (error) throw error;

  return (data || []).map((row) => ({
    id:             row.id,
    prNumber:       row.pr_number,
    prTitle:        row.pr_title,
    author:         row.author,
    repo:           `${row.owner}/${row.repo}`,
    status:         row.status,          // 'MERGED' | 'BLOCKED' | 'ESC_HUMAN'
    summary:        row.summary,
    attackType:     row.attack_type,
    patternMatches: row.pattern_matches || [],
    probe: {
      attackSucceeded: row.attack_succeeded,
      defenseHeld:     row.defense_held,
      ...(row.probe_results || {}),
    },
    recommendations: row.recommendations || [],
    scannedAt:       row.scanned_at,
  }));
}

// ── Contributor stats ─────────────────────────────────────────────────────────

/**
 * Fetch per-author reputation data from the contributor_stats view.
 */
export async function fetchContributorStats() {
  const { data, error } = await supabase
    .from('contributor_stats')
    .select('*');
  if (error) throw error;
  return data || [];
}

export default supabase;
