import React, { useState, useEffect, useCallback } from 'react';
import { Shield, ShieldAlert, RefreshCw } from 'lucide-react';
import SecurityDashboard from './SecurityDashboard';
import { fetchScans, fetchContributorStats } from '../lib/supabase';
import supabaseClient from '../lib/supabase';

export default function DashboardLayout() {
    const [scans, setScans]                       = useState([]);
    const [contributorStats, setContributorStats] = useState([]);
    const [loading, setLoading]                   = useState(true);
    const [refreshing, setRefreshing]             = useState(false);
    const [lastUpdated, setLastUpdated]           = useState(null);
    const [dbError, setDbError]                   = useState(null);

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
        } catch (err) {
            console.error('[dashboard] Failed to load data:', err.message);
            setDbError(err.message);
        } finally {
            setLoading(false);
            setRefreshing(false);
        }
    }, []);

    // Initial fetch
    useEffect(() => { loadData(); }, [loadData]);

    // Realtime — auto-refresh whenever a new scan row is inserted
    useEffect(() => {
        if (!supabaseClient) return; // no Supabase configured, skip
        const channel = supabaseClient
            .channel('scans-live')
            .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'scans' }, () => {
                console.log('[dashboard] New scan detected — refreshing…');
                loadData(true);
            })
            .subscribe();
        return () => { supabaseClient?.removeChannel(channel); };
    }, [loadData]);

    const blockedCount = scans.filter(s => s.status === 'BLOCKED').length;

    return (
        <div className="flex h-screen w-full bg-slate-50 text-slate-900 font-sans">
            <aside className="w-56 bg-white border-r border-slate-200 flex flex-col">
                <div className="p-5 border-b border-slate-200 flex items-center gap-2.5">
                    <Shield className="w-6 h-6 text-slate-800" />
                    <div>
                        <h1 className="text-lg font-bold tracking-tight text-slate-900">Sentinel</h1>
                        <p className="text-xs text-slate-400">Security Agent</p>
                    </div>
                </div>

                <nav className="flex-1 p-3">
                    <div className="w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded bg-red-50 text-red-700">
                        <ShieldAlert className="w-4 h-4 flex-shrink-0" />
                        PR Security Feed
                        {blockedCount > 0 && (
                            <span className="ml-auto bg-red-100 text-red-700 py-0.5 px-2 rounded text-xs font-semibold">
                                {blockedCount}
                            </span>
                        )}
                    </div>
                </nav>

                <div className="p-4 border-t border-slate-200 space-y-2">
                    {/* DB status indicator */}
                    {dbError ? (
                        <p className="text-xs text-red-500 font-mono break-all">⚠ DB: {dbError}</p>
                    ) : lastUpdated ? (
                        <p className="text-xs text-emerald-600">● Live — {lastUpdated.toLocaleTimeString()}</p>
                    ) : (
                        <p className="text-xs text-slate-400">Connecting…</p>
                    )}
                    <button
                        onClick={() => loadData(true)}
                        disabled={refreshing}
                        className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 transition-colors disabled:opacity-40"
                    >
                        <RefreshCw className={`w-3 h-3 ${refreshing ? 'animate-spin' : ''}`} />
                        {refreshing ? 'Refreshing…' : 'Refresh now'}
                    </button>
                </div>
            </aside>

            <main className="flex-1 overflow-auto">
                <div className="p-8 max-w-7xl mx-auto">
                    {loading ? (
                        <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
                            Loading scan history…
                        </div>
                    ) : (
                        <SecurityDashboard
                            scans={scans}
                            contributorStats={contributorStats}
                            connected={!dbError && lastUpdated !== null}
                        />
                    )}
                </div>
            </main>
        </div>
    );
}
