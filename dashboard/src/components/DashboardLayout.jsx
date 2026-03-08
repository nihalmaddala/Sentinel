import React, { useState, useEffect, useCallback } from 'react';
import {
  Shield, RefreshCw, Activity, Users, BarChart3,
  Circle, AlertTriangle, CheckCircle2, Wifi, WifiOff,
  Github, Zap
} from 'lucide-react';
import { toast } from 'react-hot-toast';
import SecurityDashboard from './SecurityDashboard';
import { fetchScans, fetchContributorStats } from '../lib/supabase';
import supabaseClient from '../lib/supabase';
import { Separator } from './ui/separator';
import { cn } from '../lib/utils';

const NAV_ITEMS = [
  { id: 'feed',         label: 'PR Security Feed',  Icon: Shield },
  { id: 'analytics',   label: 'Attack Analytics',   Icon: BarChart3 },
  { id: 'contributors',label: 'Contributors',        Icon: Users },
];

export default function DashboardLayout() {
  const [scans, setScans]                       = useState([]);
  const [contributorStats, setContributorStats] = useState([]);
  const [loading, setLoading]                   = useState(true);
  const [refreshing, setRefreshing]             = useState(false);
  const [lastUpdated, setLastUpdated]           = useState(null);
  const [dbError, setDbError]                   = useState(null);
  const [activeTab, setActiveTab]               = useState('feed');

  const loadData = useCallback(async (silent = false) => {
    if (silent) setRefreshing(true);
    else setLoading(true);
    try {
      const [scansData, statsData] = await Promise.all([
        fetchScans(),
        fetchContributorStats(),
      ]);
      setScans(scansData);
      setContributorStats(statsData);
      setLastUpdated(new Date());
      setDbError(null);
      if (silent) toast.success('Feed refreshed', { duration: 2000 });
    } catch (err) {
      console.error('[dashboard] Failed to load data:', err.message);
      setDbError(err.message);
      if (silent) toast.error('Refresh failed');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  useEffect(() => {
    if (!supabaseClient) return;
    const channel = supabaseClient
      .channel('scans-live')
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'scans' }, () => {
        loadData(true);
      })
      .subscribe();
    return () => { supabaseClient?.removeChannel(channel); };
  }, [loadData]);

  const blocked = scans.filter(s => s.status === 'BLOCKED').length;
  const statusOk = !dbError && lastUpdated !== null;

  return (
    <div className="flex h-screen w-full bg-[#09090b] text-white overflow-hidden" style={{ fontFamily: 'ui-monospace, "Cascadia Code", "Fira Code", monospace' }}>

      {/* ── Sidebar ─────────────────────────────────────────────────── */}
      <aside className="w-56 bg-[#09090b] border-r border-zinc-800 flex flex-col flex-shrink-0">
        {/* Logo / Brand */}
        <div className="px-4 py-5 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-sky-500/10 border border-sky-500/30 flex items-center justify-center flex-shrink-0">
              <Shield className="w-4 h-4 text-sky-400" strokeWidth={2} />
            </div>
            <div>
              <h1 className="text-sm font-bold tracking-tight text-white">Sentinel</h1>
              <p className="text-[10px] text-zinc-500">AI Security Agent</p>
            </div>
          </div>
          <div className="mt-3 flex items-center gap-1.5">
            <span className={cn(
              'w-1.5 h-1.5 rounded-full flex-shrink-0',
              statusOk ? 'bg-emerald-400 animate-pulse' : dbError ? 'bg-red-400' : 'bg-zinc-600'
            )} />
            <span className={cn('text-[10px]', statusOk ? 'text-emerald-400' : dbError ? 'text-red-400' : 'text-zinc-600')}>
              {statusOk ? 'live feed' : dbError ? 'db error' : 'connecting…'}
            </span>
            {blocked > 0 && (
              <span className="ml-auto text-[10px] bg-red-500/20 text-red-400 border border-red-500/30 rounded-full px-1.5 py-0.5">
                {blocked} blocked
              </span>
            )}
          </div>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-2 py-3 space-y-0.5">
          <p className="px-3 py-1 text-[9px] font-semibold uppercase tracking-widest text-zinc-600">Navigation</p>
          {NAV_ITEMS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              className={cn(
                'w-full flex items-center gap-2.5 px-3 py-2 rounded-md text-[11px] font-medium transition-all',
                activeTab === id
                  ? 'bg-sky-500/10 text-sky-400 border border-sky-500/20'
                  : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-900'
              )}
            >
              <Icon className="w-3.5 h-3.5 flex-shrink-0" />
              {label}
            </button>
          ))}
        </nav>

        <Separator />

        {/* Footer */}
        <div className="px-4 py-4 space-y-3">
          {lastUpdated && (
            <p className="text-[10px] text-zinc-600">
              Updated {lastUpdated.toLocaleTimeString()}
            </p>
          )}
          <button
            onClick={() => loadData(true)}
            disabled={refreshing}
            className="w-full flex items-center justify-center gap-1.5 text-[10px] text-zinc-600 hover:text-zinc-300 transition-colors disabled:opacity-30 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 rounded-md py-1.5"
          >
            <RefreshCw className={cn('w-3 h-3', refreshing && 'animate-spin')} />
            {refreshing ? 'Refreshing…' : 'Refresh feed'}
          </button>
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-700">
            <Github className="w-3 h-3" />
            <span>GitHub App</span>
            {statusOk ? <Wifi className="w-3 h-3 text-emerald-600 ml-auto" /> : <WifiOff className="w-3 h-3 text-red-700 ml-auto" />}
          </div>
        </div>
      </aside>

      {/* ── Main Content ─────────────────────────────────────────────── */}
      <main className="flex-1 overflow-auto bg-[#09090b]">
        {loading ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-zinc-700">
            <div className="w-10 h-10 rounded-xl bg-sky-500/5 border border-sky-500/10 flex items-center justify-center">
              <Shield className="w-5 h-5 text-sky-900 animate-pulse" />
            </div>
            <p className="text-xs">Loading security feed…</p>
          </div>
        ) : (
          <SecurityDashboard
            scans={scans}
            contributorStats={contributorStats}
            connected={!dbError && lastUpdated !== null}
            activeTab={activeTab}
            onTabChange={setActiveTab}
          />
        )}
      </main>
    </div>
  );
}
