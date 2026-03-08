'use strict';

const { createClient } = require('@supabase/supabase-js');
const config = require('../config');

// ── Client ────────────────────────────────────────────────────────────────────
let supabase = null;

if (config.supabase.url && config.supabase.serviceRoleKey) {
  supabase = createClient(config.supabase.url, config.supabase.serviceRoleKey, {
    auth: { persistSession: false },
  });
  console.log('[supabase] Client initialised ✓');
} else {
  console.warn('[supabase] SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set — persistence disabled');
}

// ── saveScan ──────────────────────────────────────────────────────────────────
async function saveScan(ctx) {
  if (!supabase) return null;

  const { pr, verdict, injectionReport } = ctx;
  const decision = verdict?.decision || 'ESC_HUMAN';

  if (decision === 'ESC_HUMAN') return null;

  const status = decision === 'BLOCK' ? 'BLOCKED' : 'MERGED';

  // Build a plain-English summary
  let summary;
  if (status === 'BLOCKED') {
    const matchCount = injectionReport?.patternMatches?.length || 0;
    const topMatch   = injectionReport?.patternMatches?.[0]?.description || 'injection payload';
    summary = `Blocked: ${matchCount} injection pattern${matchCount !== 1 ? 's' : ''} detected. Top finding: ${topMatch}.`;
  } else {
    summary = 'Clean PR — no prompt injection patterns detected.';
  }

  const row = {
    author:     pr.user    || 'unknown',
    pr_number:  pr.number,
    pr_title:   pr.title   || '(no title)',
    repo:       `${pr.owner}/${pr.repo}`,
    status,
    summary,
    scanned_at: new Date().toISOString(),
  };

  const { data, error } = await supabase.from('scans').insert(row).select('id').single();
  if (error) {
    console.error('[supabase] saveScan failed:', error.message);
    return null;
  }

  console.log(`[supabase] Saved scan ${data.id} — ${row.status} PR #${row.pr_number} by @${row.author}`);
  return data.id;
}

function getClient() {
  return supabase;
}

module.exports = { saveScan, getClient };
