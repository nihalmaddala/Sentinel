import React from 'react';

const severityConfig = {
    critical: "bg-red-50 text-red-700 border-red-200",
    high:     "bg-amber-50 text-amber-700 border-amber-200",
    medium:   "bg-yellow-50 text-yellow-800 border-yellow-200",
    low:      "bg-slate-50 text-slate-700 border-slate-200",
};

const statusDot = {
    blocked:       'bg-red-500',
    'in-progress': 'bg-blue-500',
    pending:       'bg-amber-500',
    complete:      'bg-emerald-500',
};

export default function IssuesList({ issues, onNavigate }) {
    return (
        <div className="space-y-6">
            <div>
                <h2 className="text-2xl font-bold tracking-tight text-slate-900">Active Compliance Issues</h2>
                <p className="text-sm text-slate-500 mt-1">Review and manage Sentinel compliance flags affecting pull requests.</p>
            </div>

            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                {issues.length === 0 ? (
                    <div className="flex items-center justify-center h-48 text-sm text-slate-400">
                        No open compliance issues.
                    </div>
                ) : (
                    <table className="w-full text-left text-sm">
                        <thead className="bg-slate-50 border-b border-slate-200">
                            <tr>
                                <th className="px-6 py-3 font-medium text-xs uppercase tracking-wider text-slate-500">Issue</th>
                                <th className="px-6 py-3 font-medium text-xs uppercase tracking-wider text-slate-500">Title</th>
                                <th className="px-6 py-3 font-medium text-xs uppercase tracking-wider text-slate-500">Severity</th>
                                <th className="px-6 py-3 font-medium text-xs uppercase tracking-wider text-slate-500">Regulation</th>
                                <th className="px-6 py-3 font-medium text-xs uppercase tracking-wider text-slate-500">Status</th>
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-100">
                            {issues.map(issue => (
                                <tr
                                    key={issue.issue_id}
                                    onClick={() => onNavigate('issueDetail', issue)}
                                    className="hover:bg-slate-50 cursor-pointer transition-colors"
                                >
                                    <td className="px-6 py-4 font-medium text-slate-900 text-xs font-mono">{issue.issue_id}</td>
                                    <td className="px-6 py-4 font-medium text-slate-700">{issue.title}</td>
                                    <td className="px-6 py-4">
                                        <span className={`px-2.5 py-1 text-xs font-semibold rounded border uppercase tracking-wide ${severityConfig[issue.severity] || 'bg-slate-50 text-slate-700 border-slate-200'}`}>
                                            {issue.severity}
                                        </span>
                                    </td>
                                    <td className="px-6 py-4 text-slate-600 text-xs">{issue.regulation || '--'}</td>
                                    <td className="px-6 py-4">
                                        <span className="flex items-center gap-1.5 text-slate-600 capitalize text-xs">
                                            <span className={`w-2 h-2 rounded-full ${statusDot[issue.status] || 'bg-slate-400'}`}></span>
                                            {issue.status}
                                        </span>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                )}
            </div>
        </div>
    );
}
