import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// ── Overview ──────────────────────────────────────────────────────────────────

export async function fetchOverview() {
  const { data, error } = await supabase.rpc('get_dashboard_overview');
  if (error) throw error;
  return data;
}

// ── Issues ────────────────────────────────────────────────────────────────────

export async function fetchIssues() {
  const { data, error } = await supabase
    .from('issues')
    .select('issue_id, title, severity, regulation, status, repository, pr_number, created_at')
    .neq('status', 'complete')
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data || [];
}

export async function fetchIssue(issueId) {
  const { data, error } = await supabase
    .from('issues')
    .select('*')
    .eq('issue_id', issueId)
    .single();
  if (error) throw error;
  return data;
}

export default supabase;
