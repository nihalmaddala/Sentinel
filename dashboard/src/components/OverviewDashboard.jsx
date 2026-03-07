import React from 'react';
import {
    Activity, ShieldAlert, AlertCircle, FileText,
    TrendingUp, Lock, Users, Briefcase
} from 'lucide-react';
import {
    AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer,
    BarChart, Bar, PieChart, Pie, Cell, CartesianGrid
} from 'recharts';

const TEAM_STYLES = {
    Engineering: { icon: Lock,     color: 'text-slate-700',   bg: 'bg-slate-100' },
    Legal:       { icon: Briefcase, color: 'text-slate-700', bg: 'bg-slate-100' },
    Product:     { icon: Users,    color: 'text-slate-700', bg: 'bg-slate-100' },
    Compliance:  { icon: FileText, color: 'text-slate-700',  bg: 'bg-slate-100' },
};

const FALLBACK = {
    kpis: { complianceScore: 100, totalOpenIssues: 0, blockedPRs: 0, activeRegulations: 0 },
    breakdown: { criticalIssues: 0, repoCoverage: [{ name: 'Covered', value: 100, fill: '#10b981' }, { name: 'Uncovered', value: 0, fill: '#e2e8f0' }], actionsByTeam: [] },
    trends: { resolutionOverTime: [], topRegulations: [] },
    repositories: [],
    recentBlockers: [],
};

export default function OverviewDashboard({ data, onNavigate }) {
    const d = data || FALLBACK;
    const kpis = d.kpis || FALLBACK.kpis;
    const breakdown = d.breakdown || FALLBACK.breakdown;
    const trends = d.trends || FALLBACK.trends;
    const repositories = d.repositories || [];
    const recentBlockers = d.recentBlockers || [];

    const repoCoverage = (breakdown.repoCoverage || []).map((r, i) => ({
        ...r,
        fill: i === 0 ? '#10b981' : '#e2e8f0',
    }));

    const actionsByTeam = (breakdown.actionsByTeam || []).map(t => ({
        ...t,
        ...(TEAM_STYLES[t.team] || TEAM_STYLES.Compliance),
    }));

    return (
        <div className="space-y-6 animate-in fade-in duration-500">
            <div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">Enterprise Posture</h2>
                <p className="text-sm text-slate-500 mt-1">High-level compliance state across all monitored repositories.</p>
            </div>

            {/* KPIs */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="bg-white p-5 rounded-lg border border-slate-200">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Compliance Score</p>
                            <div className="flex items-baseline gap-2 mt-2">
                                <p className="text-3xl font-bold text-slate-900">{kpis.complianceScore}%</p>
                                <TrendingUp className="w-4 h-4 text-emerald-600" />
                            </div>
                        </div>
                        <div className="p-2 bg-slate-100 rounded-md text-slate-500">
                            <Activity className="w-5 h-5" />
                        </div>
                    </div>
                </div>

                <div className="bg-white p-5 rounded-lg border border-slate-200">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Open Issues</p>
                            <p className="text-3xl font-bold text-slate-900 mt-2">{kpis.totalOpenIssues}</p>
                        </div>
                        <div className="p-2 bg-slate-100 rounded-md text-slate-500">
                            <AlertCircle className="w-5 h-5" />
                        </div>
                    </div>
                </div>

                <div className="bg-white p-5 rounded-lg border border-slate-200">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Blocked PRs</p>
                            <p className="text-3xl font-bold text-slate-900 mt-2">{kpis.blockedPRs}</p>
                        </div>
                        <div className="p-2 bg-slate-100 rounded-md text-slate-500">
                            <ShieldAlert className="w-5 h-5" />
                        </div>
                    </div>
                </div>

                <div className="bg-white p-5 rounded-lg border border-slate-200">
                    <div className="flex justify-between items-start">
                        <div>
                            <p className="text-xs font-medium text-slate-500 uppercase tracking-wide">Regulations Flagged</p>
                            <p className="text-3xl font-bold text-slate-900 mt-2">{kpis.activeRegulations}</p>
                        </div>
                        <div className="p-2 bg-slate-100 rounded-md text-slate-500">
                            <FileText className="w-5 h-5" />
                        </div>
                    </div>
                </div>
            </div>

            {/* Breakdown */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-lg border border-red-200 relative overflow-hidden flex flex-col justify-center items-center col-span-1">
                    <p className="text-xs font-semibold tracking-wider text-red-600 uppercase mb-2 z-10">Critical Risks</p>
                    <p className="text-5xl font-bold text-slate-900 z-10">{breakdown.criticalIssues}</p>
                    <p className="text-xs text-slate-500 mt-3 text-center z-10">Requires immediate attention before release</p>
                    <button
                        onClick={() => onNavigate('issues')}
                        className="mt-5 px-5 py-2 bg-slate-900 hover:bg-slate-800 text-white text-xs font-semibold rounded transition-colors z-10 uppercase tracking-wide"
                    >
                        Review Now
                    </button>
                </div>

                <div className="bg-white p-6 rounded-lg border border-slate-200 col-span-1 flex flex-col">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">Repository Coverage</h3>
                    <div className="flex-1 min-h-[200px] relative">
                        <ResponsiveContainer width="100%" height="100%">
                            <PieChart>
                                <Pie data={repoCoverage} innerRadius={60} outerRadius={80} paddingAngle={5} dataKey="value" stroke="none">
                                    {repoCoverage.map((entry, index) => (
                                        <Cell key={`cell-${index}`} fill={entry.fill} />
                                    ))}
                                </Pie>
                                <Tooltip formatter={(value) => [`${value}%`, 'Coverage']} contentStyle={{ borderRadius: '8px', border: 'none', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                            </PieChart>
                        </ResponsiveContainer>
                        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                            <span className="text-3xl font-bold text-slate-900">{repoCoverage[0]?.value ?? 100}%</span>
                            <span className="text-xs text-slate-500 font-medium">Secured</span>
                        </div>
                    </div>
                </div>

                <div className="bg-white p-6 rounded-lg border border-slate-200 col-span-1 flex flex-col">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">Pending Actions by Team</h3>
                    {actionsByTeam.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center text-sm text-slate-400">No pending actions</div>
                    ) : (
                        <div className="flex-1 flex flex-col justify-center space-y-3">
                            {actionsByTeam.map((team, idx) => {
                                const Icon = team.icon;
                                return (
                                    <div key={idx} className="flex items-center justify-between p-3 hover:bg-slate-50 rounded transition-colors border border-transparent hover:border-slate-100">
                                        <div className="flex items-center gap-3">
                                            <div className={`p-1.5 rounded ${team.bg} ${team.color}`}>
                                                <Icon className="w-4 h-4" />
                                            </div>
                                            <span className="text-sm font-medium text-slate-700">{team.team}</span>
                                        </div>
                                        <span className="font-semibold text-slate-900 bg-slate-100 px-2.5 py-0.5 rounded text-xs">
                                            {team.count}
                                        </span>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* Charts */}
            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="bg-white p-6 rounded-lg border border-slate-200 lg:col-span-2 flex flex-col">
                    <div className="flex justify-between items-center mb-6">
                        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Compliance Resolution Trend</h3>
                        <div className="flex gap-4 text-xs font-medium text-slate-500">
                            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-red-500"></div> Critical</div>
                            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-amber-400"></div> High</div>
                            <div className="flex items-center gap-1.5"><div className="w-2 h-2 rounded-full bg-yellow-400"></div> Medium</div>
                        </div>
                    </div>
                    <div className="flex-1 min-h-[260px]">
                        {trends.resolutionOverTime.length === 0 ? (
                            <div className="h-full flex items-center justify-center text-sm text-slate-400">No trend data yet</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <AreaChart data={trends.resolutionOverTime} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                                    <defs>
                                        <linearGradient id="colorCritical" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#ef4444" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#ef4444" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="colorHigh" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#f97316" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#f97316" stopOpacity={0} />
                                        </linearGradient>
                                        <linearGradient id="colorMedium" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#facc15" stopOpacity={0.3} />
                                            <stop offset="95%" stopColor="#facc15" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#e2e8f0" />
                                    <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} dy={10} />
                                    <YAxis axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#64748b' }} />
                                    <Tooltip contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} labelStyle={{ fontWeight: 'bold', color: '#0f172a', marginBottom: '4px' }} />
                                    <Area type="monotone" dataKey="critical" stackId="1" stroke="#ef4444" strokeWidth={2} fill="url(#colorCritical)" />
                                    <Area type="monotone" dataKey="high"     stackId="1" stroke="#f97316" strokeWidth={2} fill="url(#colorHigh)" />
                                    <Area type="monotone" dataKey="medium"   stackId="1" stroke="#facc15" strokeWidth={2} fill="url(#colorMedium)" />
                                </AreaChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>

                <div className="bg-white p-6 rounded-lg border border-slate-200 col-span-1 flex flex-col">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-6">Top Triggered Regulations</h3>
                    <div className="flex-1 min-h-[260px]">
                        {trends.topRegulations.length === 0 ? (
                            <div className="h-full flex items-center justify-center text-sm text-slate-400">No data yet</div>
                        ) : (
                            <ResponsiveContainer width="100%" height="100%">
                                <BarChart layout="vertical" data={trends.topRegulations} margin={{ top: 0, right: 20, left: 0, bottom: 0 }}>
                                    <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#e2e8f0" />
                                    <XAxis type="number" hide />
                                    <YAxis dataKey="name" type="category" axisLine={false} tickLine={false} tick={{ fontSize: 12, fill: '#475569', fontWeight: 500 }} width={80} />
                                    <Tooltip cursor={{ fill: '#f8fafc' }} contentStyle={{ borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)' }} />
                                    <Bar dataKey="count" fill="#4f46e5" radius={[0, 4, 4, 0]} barSize={24}>
                                        {trends.topRegulations.map((_, index) => (
                                            <Cell key={`cell-${index}`} fill={index === 0 ? '#4f46e5' : '#818cf8'} />
                                        ))}
                                    </Bar>
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            </div>

            {/* Tables */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <div className="bg-white p-6 rounded-lg border border-slate-200 flex flex-col">
                    <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-4">Repositories with Critical Risk</h3>
                    {repositories.length === 0 ? (
                        <div className="flex-1 flex items-center justify-center text-sm text-slate-400">No repository data yet</div>
                    ) : (
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse">
                                <thead>
                                    <tr className="border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
                                        <th className="pb-3 font-medium">Repository</th>
                                        <th className="pb-3 font-medium text-center">Risk Score</th>
                                        <th className="pb-3 font-medium text-right">Open Criticals</th>
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {repositories.map((repo, idx) => (
                                        <tr key={idx} className="hover:bg-slate-50 transition-colors group">
                                            <td className="py-3 text-sm font-medium text-slate-900 group-hover:text-indigo-600 transition-colors">{repo.name}</td>
                                            <td className="py-3 text-center">
                                                <span className={`inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold ${repo.riskScore > 90 ? 'bg-red-100 text-red-800' : repo.riskScore > 80 ? 'bg-orange-100 text-orange-800' : 'bg-yellow-100 text-yellow-800'}`}>
                                                    {repo.riskScore}/100
                                                </span>
                                            </td>
                                            <td className="py-3 text-right">
                                                <div className="flex items-center justify-end gap-1.5 text-red-600 font-semibold text-sm">
                                                    <span>{repo.openCriticals}</span>
                                                    <ShieldAlert className="w-4 h-4" />
                                                </div>
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                <div className="bg-white p-6 rounded-lg border border-slate-200 flex flex-col">
                    <div className="flex justify-between items-center mb-4">
                        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Recent Blockers</h3>
                        <button onClick={() => onNavigate('issues')} className="text-slate-600 hover:text-slate-900 text-xs font-medium">View All</button>
                    </div>
                    <div className="flex-1 space-y-3 overflow-auto">
                        {recentBlockers.length === 0 ? (
                            <div className="flex items-center justify-center h-24 text-sm text-slate-400">No active blockers</div>
                        ) : (
                            recentBlockers.map((blocker, idx) => (
                                <div
                                    key={idx}
                                    onClick={() => onNavigate('issues')}
                                    className="p-4 border border-slate-200 rounded cursor-pointer transition-colors hover:bg-slate-50"
                                >
                                    <div className="flex items-center gap-2">
                                        {blocker.severity === 'critical'
                                            ? <ShieldAlert className="w-4 h-4 text-red-600" />
                                            : <AlertCircle className="w-4 h-4 text-amber-600" />
                                        }
                                        <span className="font-medium text-sm text-slate-900">
                                            {blocker.id}: {blocker.title}
                                        </span>
                                    </div>
                                    <p className="text-xs mt-1 ml-6 text-slate-500">
                                        {blocker.context}
                                    </p>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
