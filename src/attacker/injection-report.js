'use strict';

/**
 * Renders the Prompt Injection Scan section for the GitHub PR audit comment.
 * Appended to the existing Argus compliance report.
 */

const SEVERITY_ICON = { CRITICAL: '🔴', HIGH: '🟠', MEDIUM: '🟡', LOW: '🟢' };
const STATUS_ICON   = { CLEAN: '✅', BLOCKED: '🛡️', CRITICAL: '🚨' };

/**
 * Render a full markdown injection report section.
 * @param {object} report  ctx.injectionReport
 * @returns {string}  Markdown string
 */
function renderInjectionReport(report) {
  if (!report) return '';

  const icon   = STATUS_ICON[report.status] || '❓';
  const lines  = [];

  lines.push('---');
  lines.push(`## ${icon} Argus Security Scan — Prompt Injection Analysis`);
  lines.push('');

  // Status banner
  if (report.status === 'CLEAN') {
    lines.push('> ✅ **No prompt injection detected.** This PR does not contain adversarial inputs targeting the compliance pipeline.');
    lines.push('');
    return lines.join('\n');
  }

  // Summary line
  lines.push(`> **${report.summary}**`);
  lines.push('');

  // Results table
  lines.push('| Check | Result |');
  lines.push('|-------|--------|');
  lines.push(`| Pattern Scan (Layer 1) | ${report.detected ? '🔴 Injection patterns found' : '✅ No patterns found'} |`);
  lines.push(`| Undefended GPT-4o Probe | ${report.probe.attackSucceeded ? `🚨 **FOOLED** — returned \`${report.probe.undefended.decision}\`` : `✅ Held firm — returned \`${report.probe.undefended.decision}\``} |`);
  lines.push(`| Defended Argus Probe | ${report.probe.defenseHeld ? `🛡️ **Blocked** — returned \`${report.probe.defended.decision}\`` : `🚨 **BYPASSED** — returned \`${report.probe.defended.decision}\``} |`);
  lines.push(`| Overall Status | ${report.status === 'CRITICAL' ? '🚨 **CRITICAL — Attack succeeded**' : '🛡️ **BLOCKED — Defense held**'} |`);
  lines.push('');

  // Pattern matches
  if (report.patternMatches?.length > 0) {
    lines.push('### 🔍 Injection Patterns Found');
    lines.push('');
    lines.push('| Severity | Line | Pattern | Content |');
    lines.push('|----------|------|---------|---------|');
    for (const m of report.patternMatches.slice(0, 10)) {
      const icon = SEVERITY_ICON[m.severity] || '⚪';
      const content = m.lineContent.slice(0, 80).replace(/\|/g, '\\|');
      lines.push(`| ${icon} ${m.severity} | ${m.lineNumber} | ${m.description} | \`${content}\` |`);
    }
    lines.push('');
  }

  // Probe details
  lines.push('### 🧪 Live Attack Probe Results');
  lines.push('');

  lines.push('<details>');
  lines.push('<summary>Undefended GPT-4o (no injection awareness)</summary>');
  lines.push('');
  lines.push(`**Decision:** \`${report.probe.undefended.decision}\``);
  lines.push('');
  lines.push(`**Reasoning:** ${report.probe.undefended.reason || 'N/A'}`);
  lines.push('');
  lines.push(report.probe.undefended.fooled
    ? '> 🚨 The undefended model was successfully manipulated by the injected payload.'
    : '> ✅ The undefended model was not fooled by the injection attempt.');
  lines.push('</details>');
  lines.push('');

  lines.push('<details>');
  lines.push('<summary>Defended Argus (injection-aware hardened prompt)</summary>');
  lines.push('');
  lines.push(`**Decision:** \`${report.probe.defended.decision}\``);
  lines.push('');
  lines.push(`**Reasoning:** ${report.probe.defended.reason || 'N/A'}`);
  lines.push('');
  lines.push(report.probe.defenseHeld
    ? '> 🛡️ The hardened Argus prompt successfully neutralized the injection attempt.'
    : '> 🚨 The injection bypassed even the hardened Argus prompt. This is a critical vulnerability.');
  lines.push('</details>');
  lines.push('');

  // What this means
  lines.push('### ⚡ What This Means');
  lines.push('');
  if (report.status === 'CRITICAL') {
    lines.push('This PR contains a **prompt injection attack that successfully manipulated AI-based compliance analysis**.');
    lines.push('');
    lines.push('- An attacker could use this technique to bypass compliance gates and ship violating code');
    lines.push('- The injected payload caused GPT-4o to ignore regulatory violations and return an approval');
    lines.push('- **This PR must be blocked regardless of its compliance score**');
  } else {
    lines.push('This PR contains a **prompt injection attempt that was successfully detected and neutralized** by Argus.');
    lines.push('');
    lines.push('- The injection attempt was caught before it could influence the compliance verdict');
    lines.push('- Argus\'s hardened prompt resisted the manipulation attempt');
    lines.push('- **This PR is blocked due to the injection attempt itself being a security violation**');
  }
  lines.push('');
  lines.push(`_Scanned at ${report.scannedAt}_`);

  return lines.join('\n');
}

module.exports = { renderInjectionReport };
