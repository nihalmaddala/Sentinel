import React, { useState } from 'react';
import {
    ArrowLeft,
    CheckCircle2,
    Circle,
    Clock,
    FileCode,
    GitPullRequest,
    ShieldAlert,
    AlertCircle,
} from 'lucide-react';
import MarkdownReport from './MarkdownReport';

const getSeverityStyles = (severity) => {
    const styles = {
        critical: "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20",
        high:     "bg-amber-50 text-amber-700 ring-1 ring-inset ring-amber-600/20",
        medium:   "bg-yellow-50 text-yellow-700 ring-1 ring-inset ring-yellow-600/20",
        low:      "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
    };
    return styles[severity?.toLowerCase()] || styles.low;
};

const getStatusStyles = (status) => {
    const styles = {
        'blocked':     "bg-red-50 text-red-700 ring-1 ring-inset ring-red-600/20",
        'in-progress': "bg-blue-50 text-blue-700 ring-1 ring-inset ring-blue-600/20",
        'pending':     "bg-slate-50 text-slate-700 ring-1 ring-inset ring-slate-600/20",
        'complete':    "bg-emerald-50 text-emerald-700 ring-1 ring-inset ring-emerald-600/20",
    };
    return styles[status?.toLowerCase()] || styles.pending;
};

const getTodoIcon = (status) => {
    switch (status?.toLowerCase()) {
        case 'complete':    return <CheckCircle2 className="w-4 h-4 text-emerald-600" />;
        case 'in-progress': return <Clock className="w-4 h-4 text-blue-600" />;
        default:            return <Circle className="w-4 h-4 text-slate-300" />;
    }
};

const TodoRow = ({ todo }) => (
    <div className="flex items-start justify-between py-3 border-b border-slate-100 last:border-0">
        <div className="flex items-start gap-3">
            <div className="mt-0.5">{getTodoIcon(todo.status)}</div>
            <div>
                <p className={`text-sm ${todo.status === 'complete' ? 'text-slate-400 line-through' : 'text-slate-800'}`}>
                    {todo.task}
                </p>
                <div className="flex items-center gap-2 mt-1.5">
                    <span className="inline-flex items-center rounded px-2 py-0.5 text-xs font-medium text-slate-500 bg-slate-100 border border-slate-200">
                        {todo.team}
                    </span>
                    <span className="text-xs text-slate-400">
                        {todo.assignee}
                    </span>
                </div>
            </div>
        </div>
        <span className={`inline-flex items-center rounded px-2 py-0.5 text-xs font-medium capitalize ${getStatusStyles(todo.status)}`}>
            {todo.status?.replace('-', ' ')}
        </span>
    </div>
);

export default function IssueDetail({ issue, onBack = () => {} }) {
    const TABS = ['Engineering', 'Legal', 'Compliance', 'Product'];
    const [activeTab, setActiveTab] = useState('Engineering');

    if (!issue) {
        return (
            <div className="flex items-center justify-center h-64 text-slate-400 text-sm">
                No issue selected.
            </div>
        );
    }

    const todos   = issue.todos   || [];
    const reports = issue.reports || [];

    const activeReport = reports.find(r => r.team === activeTab)?.report;
    const activeTodos  = todos.filter(t => t.team === activeTab);

    return (
        <div className="max-w-5xl mx-auto p-6 space-y-6">
            {/* Back navigation */}
            <button
                onClick={onBack}
                className="flex items-center gap-2 text-sm font-medium text-slate-500 hover:text-slate-900 transition-colors"
            >
                <ArrowLeft className="w-4 h-4" />
                Back to Issues
            </button>

            {/* Issue header */}
            <div className="space-y-4">
                <div className="flex items-center gap-3">
                    <span className={`inline-flex items-center gap-1.5 rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${getSeverityStyles(issue.severity)}`}>
                        {issue.severity === 'critical' ? <ShieldAlert className="w-3.5 h-3.5" /> : <AlertCircle className="w-3.5 h-3.5" />}
                        {issue.severity}
                    </span>
                    <span className={`inline-flex items-center rounded px-2.5 py-1 text-xs font-semibold uppercase tracking-wide ${getStatusStyles(issue.status)}`}>
                        {issue.status}
                    </span>
                    {issue.regulation && (
                        <span className="inline-flex items-center rounded bg-slate-100 px-2.5 py-1 text-xs font-semibold text-slate-700 ring-1 ring-inset ring-slate-300">
                            {issue.regulation}
                        </span>
                    )}
                </div>

                <h1 className="text-2xl font-bold text-slate-900 tracking-tight">
                    {issue.issue_id}: {issue.title}
                </h1>

                <p className="text-sm text-slate-600 max-w-4xl leading-relaxed">
                    {issue.description}
                </p>

                <div className="flex flex-wrap items-center gap-3 text-sm text-slate-600 pt-1">
                    {issue.source_file && (
                        <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded border border-slate-200">
                            <FileCode className="w-3.5 h-3.5 text-slate-400" />
                            <span className="font-mono text-xs">{issue.source_file}</span>
                        </div>
                    )}
                    {issue.pr_number && (
                        <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded border border-slate-200">
                            <GitPullRequest className="w-3.5 h-3.5 text-slate-400" />
                            <span className="text-xs font-medium">PR #{issue.pr_number}</span>
                        </div>
                    )}
                    {issue.repository && (
                        <div className="flex items-center gap-1.5 bg-slate-50 px-3 py-1.5 rounded border border-slate-200">
                            <span className="text-xs font-medium">{issue.repository}</span>
                        </div>
                    )}
                </div>
            </div>

            {/* Remediation actions */}
            <div className="bg-white p-6 rounded-lg border border-slate-200">
                <h2 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mb-4">Remediation Actions</h2>
                {todos.length === 0 ? (
                    <p className="text-sm text-slate-400">No remediation actions recorded.</p>
                ) : (
                    <div className="flex flex-col">
                        {todos.map((todo, i) => <TodoRow key={todo.id ?? i} todo={todo} />)}
                    </div>
                )}
            </div>

            {/* Team reports — tabbed, markdown-rendered */}
            <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                <div className="flex border-b border-slate-200 px-1 bg-slate-50">
                    {TABS.map(tab => (
                        <button
                            key={tab}
                            onClick={() => setActiveTab(tab)}
                            className={`px-5 py-3 text-sm font-medium transition-colors border-b-2 outline-none -mb-px ${activeTab === tab
                                ? 'border-slate-900 text-slate-900'
                                : 'border-transparent text-slate-500 hover:text-slate-700 hover:border-slate-300'
                            }`}
                        >
                            {tab}
                        </button>
                    ))}
                </div>

                <div className="p-6">
                    {activeReport ? (
                        <MarkdownReport content={activeReport} />
                    ) : (
                        <div className="bg-slate-50 border border-dashed border-slate-200 rounded-md p-8 text-center text-slate-400 text-sm">
                            No report generated for the {activeTab} team on this issue.
                        </div>
                    )}

                    {activeTodos.length > 0 && (
                        <>
                            <h3 className="text-sm font-semibold text-slate-900 uppercase tracking-wide mt-8 mb-4">
                                {activeTab} Action Items
                            </h3>
                            <div className="border border-slate-200 rounded-md divide-y divide-slate-100 p-2">
                                {activeTodos.map((todo, i) => (
                                    <div key={todo.id ?? i} className="px-2">
                                        <TodoRow todo={todo} />
                                    </div>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
}
