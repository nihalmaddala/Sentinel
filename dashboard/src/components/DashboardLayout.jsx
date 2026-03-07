import React, { useState, useEffect } from 'react';
import { LayoutDashboard, AlertCircle, Shield } from 'lucide-react';
import OverviewDashboard from './OverviewDashboard';
import IssuesList from './IssuesList';
import IssueDetail from './IssueDetail';
import { fetchOverview, fetchIssues, fetchIssue } from '../lib/supabase';

export default function DashboardLayout() {
    const [currentView, setCurrentView] = useState('overview');
    const [selectedIssue, setSelectedIssue] = useState(null);
    const [issues, setIssues] = useState([]);
    const [overview, setOverview] = useState(null);
    const [loading, setLoading] = useState(true);

    useEffect(() => {
        async function loadData() {
            try {
                const [ovData, issuesData] = await Promise.all([
                    fetchOverview(),
                    fetchIssues(),
                ]);
                setOverview(ovData);
                setIssues(issuesData);
            } catch (err) {
                console.error('[dashboard] Failed to load data:', err.message);
            } finally {
                setLoading(false);
            }
        }
        loadData();
    }, []);

    const navigateTo = async (view, issueRow = null) => {
        if (view === 'issueDetail' && issueRow) {
            try {
                const full = await fetchIssue(issueRow.issue_id);
                setSelectedIssue(full);
            } catch {
                setSelectedIssue(issueRow);
            }
        }
        setCurrentView(view);
    };

    const openIssueCount = issues.length;

    return (
        <div className="flex h-screen w-full bg-slate-50 text-slate-900 font-sans">
            <aside className="w-56 bg-white border-r border-slate-200 flex flex-col">
                <div className="p-5 border-b border-slate-200 flex items-center gap-2.5">
                    <Shield className="w-6 h-6 text-slate-800" />
                    <h1 className="text-lg font-bold tracking-tight text-slate-900">Argus</h1>
                </div>
                <nav className="flex-1 p-3 space-y-0.5">
                    <button
                        onClick={() => navigateTo('overview')}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded transition-colors ${currentView === 'overview' ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'}`}
                    >
                        <LayoutDashboard className="w-4 h-4" />
                        Overview
                    </button>
                    <button
                        onClick={() => navigateTo('issues')}
                        className={`w-full flex items-center gap-2.5 px-3 py-2 text-sm font-medium rounded transition-colors ${currentView === 'issues' || currentView === 'issueDetail' ? 'bg-slate-100 text-slate-900' : 'text-slate-600 hover:bg-slate-50 hover:text-slate-800'}`}
                    >
                        <AlertCircle className="w-4 h-4" />
                        Issues
                        {openIssueCount > 0 && (
                            <span className="ml-auto bg-slate-200 text-slate-700 py-0.5 px-2 rounded text-xs font-semibold">
                                {openIssueCount}
                            </span>
                        )}
                    </button>
                </nav>
                <div className="p-4 border-t border-slate-200">
                    <p className="text-xs text-slate-400">Argus Compliance v1.0</p>
                </div>
            </aside>

            <main className="flex-1 overflow-auto">
                <div className="p-8 max-w-7xl mx-auto">
                    {loading ? (
                        <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
                            Loading compliance data...
                        </div>
                    ) : (
                        <>
                            {currentView === 'overview' && (
                                <OverviewDashboard data={overview} onNavigate={navigateTo} />
                            )}
                            {currentView === 'issues' && (
                                <IssuesList issues={issues} onNavigate={navigateTo} />
                            )}
                            {currentView === 'issueDetail' && selectedIssue && (
                                <IssueDetail issue={selectedIssue} onBack={() => navigateTo('issues')} />
                            )}
                        </>
                    )}
                </div>
            </main>
        </div>
    );
}
