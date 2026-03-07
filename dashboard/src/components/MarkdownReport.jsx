import React from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';

/**
 * Enterprise-grade Markdown renderer for Argus compliance reports.
 * Renders report text as proper Markdown with GFM (tables, task lists, etc.)
 * styled for a professional dashboard context.
 */
export default function MarkdownReport({ content }) {
    if (!content) return null;

    return (
        <div className="argus-report prose prose-sm max-w-none">
            <ReactMarkdown
                remarkPlugins={[remarkGfm]}
                components={{
                    // Headings
                    h1: ({ children }) => (
                        <h1 className="text-xl font-semibold text-slate-900 border-b border-slate-200 pb-2 mb-4 mt-6 first:mt-0">
                            {children}
                        </h1>
                    ),
                    h2: ({ children }) => (
                        <h2 className="text-lg font-semibold text-slate-900 border-b border-slate-100 pb-1.5 mb-3 mt-5 first:mt-0">
                            {children}
                        </h2>
                    ),
                    h3: ({ children }) => (
                        <h3 className="text-base font-semibold text-slate-800 mb-2 mt-4 first:mt-0">
                            {children}
                        </h3>
                    ),

                    // Paragraphs
                    p: ({ children }) => (
                        <p className="text-sm text-slate-700 leading-relaxed mb-3 last:mb-0">
                            {children}
                        </p>
                    ),

                    // Strong / emphasis
                    strong: ({ children }) => (
                        <strong className="font-semibold text-slate-900">{children}</strong>
                    ),
                    em: ({ children }) => (
                        <em className="text-slate-600 not-italic text-xs">{children}</em>
                    ),

                    // Lists
                    ul: ({ children }) => (
                        <ul className="list-none space-y-1.5 mb-3 pl-0">{children}</ul>
                    ),
                    ol: ({ children }) => (
                        <ol className="list-decimal list-outside space-y-1.5 mb-3 pl-5 marker:text-slate-400 marker:font-medium">{children}</ol>
                    ),
                    li: ({ children, ...props }) => {
                        // Check if this is a task list item
                        const hasCheckbox = props.className === 'task-list-item';
                        return (
                            <li className={`text-sm text-slate-700 leading-relaxed ${hasCheckbox ? 'flex items-start gap-2 list-none' : 'pl-1'}`}>
                                {!hasCheckbox && <span className="text-slate-900 mr-2 select-none">--</span>}
                                {children}
                            </li>
                        );
                    },

                    // Code
                    code: ({ inline, children }) =>
                        inline ? (
                            <code className="px-1.5 py-0.5 bg-slate-100 border border-slate-200 rounded text-xs font-mono text-slate-800">
                                {children}
                            </code>
                        ) : (
                            <code className="text-xs font-mono text-slate-900">{children}</code>
                        ),
                    pre: ({ children }) => (
                        <pre className="bg-slate-900 text-slate-100 p-4 rounded-md text-xs font-mono overflow-x-auto mb-3 border border-slate-800">
                            {children}
                        </pre>
                    ),

                    // Blockquotes
                    blockquote: ({ children }) => (
                        <blockquote className="border-l-2 border-slate-300 pl-4 py-1 my-3 bg-slate-50 rounded-r-md">
                            {children}
                        </blockquote>
                    ),

                    // Tables
                    table: ({ children }) => (
                        <div className="overflow-x-auto mb-4 rounded-md border border-slate-200">
                            <table className="w-full text-sm text-left">{children}</table>
                        </div>
                    ),
                    thead: ({ children }) => (
                        <thead className="bg-slate-50 border-b border-slate-200 text-xs uppercase tracking-wider text-slate-500">
                            {children}
                        </thead>
                    ),
                    tbody: ({ children }) => (
                        <tbody className="divide-y divide-slate-100">{children}</tbody>
                    ),
                    tr: ({ children }) => (
                        <tr className="hover:bg-slate-50/50 transition-colors">{children}</tr>
                    ),
                    th: ({ children }) => (
                        <th className="px-4 py-2.5 font-medium text-slate-600">{children}</th>
                    ),
                    td: ({ children }) => (
                        <td className="px-4 py-2.5 text-slate-700">{children}</td>
                    ),

                    // Links
                    a: ({ href, children }) => (
                        <a
                            href={href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-blue-600 hover:text-blue-800 underline decoration-blue-200 hover:decoration-blue-400 transition-colors"
                        >
                            {children}
                        </a>
                    ),

                    // Horizontal rules
                    hr: () => <hr className="border-t border-slate-200 my-4" />,

                    // Checkboxes (GFM task lists)
                    input: ({ type, checked }) => {
                        if (type === 'checkbox') {
                            return (
                                <span className={`inline-flex items-center justify-center w-4 h-4 rounded border flex-shrink-0 mt-0.5 ${
                                    checked
                                        ? 'bg-slate-800 border-slate-800 text-white'
                                        : 'border-slate-300 bg-white'
                                }`}>
                                    {checked && (
                                        <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}>
                                            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                                        </svg>
                                    )}
                                </span>
                            );
                        }
                        return null;
                    },
                }}
            >
                {content}
            </ReactMarkdown>
        </div>
    );
}
