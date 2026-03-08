import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_ANON_KEY = import.meta.env.VITE_SUPABASE_ANON_KEY;

// If env vars are not set the dashboard falls back to demo data — no crash.
const supabaseClient = (SUPABASE_URL && SUPABASE_ANON_KEY)
  ? createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      realtime: { params: { eventsPerSecond: 10 } },
    })
  : null;

// ── Scans ─────────────────────────────────────────────────────────────────────

export async function fetchScans() {
  if (!supabaseClient) return [];
  const { data, error } = await supabaseClient
    .from('scans')
    .select('id, author, pr_number, pr_title, repo, status, summary, scanned_at')
    .order('scanned_at', { ascending: false });
  if (error) throw error;

  return (data || []).map((row) => ({
    id:        row.id,
    author:    row.author,
    prNumber:  row.pr_number,
    prTitle:   row.pr_title,
    repo:      row.repo,
    status:    row.status,    // 'MERGED' | 'BLOCKED'
    summary:   row.summary,
    scannedAt: row.scanned_at,
    // Provide empty defaults so SecurityDashboard doesn't crash
    attackType:     null,
    patternMatches: [],
    probe:          { attackSucceeded: row.status === 'BLOCKED', defenseHeld: true },
  }));
}

// ── Contributor stats ─────────────────────────────────────────────────────────

export async function fetchContributorStats() {
  if (!supabaseClient) return [];
  const { data, error } = await supabaseClient
    .from('contributor_stats')
    .select('author, total, blocked, merged, block_pct, last_seen');
  if (error) throw error;
  return data || [];
}

export default supabaseClient;

