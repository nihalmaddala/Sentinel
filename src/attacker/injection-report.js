'use strict';

/**
 * Renders the Prompt Injection Scan section for the GitHub PR audit comment.
 * Appended to the existing Sentinel report.
 */

/**
 * Render a full markdown injection report section.
 * @param {object} report  ctx.injectionReport
 * @returns {string}  Markdown string
 */
function renderInjectionReport(report) {
  if (!report) return '';

  const lines  = [];

  lines.push('---');
  lines.push('## Sentinel — Prompt Injection Scan');
  lines.push('');

  // Status banner
  if (report.status === 'CLEAN') {
    lines.push('> **No prompt injection detected.** This PR does not contain adversarial inputs targeting the AI pipeline.');
    lines.push('');
    return lines.join('\n');
  }

  // Summary line
  lines.push(`> **${report.summary}**`);
  lines.push('');

  // Results table
  lines.push('| Check | Result |');
  lines.push('|-------|--------|');
  lines.push(`| Pattern Scan (Layer 1) | ${report.detected ? 'FAIL — Injection patterns found' : 'PASS — No patterns found'} |`);
  lines.push(`| Undefended GPT-4o Probe | ${report.probe.attackSucceeded ? `FOOLED — returned \`${report.probe.undefended.decision}\`` : `Held firm — returned \`${report.probe.undefended.decision}\``} |`);
  lines.push(`| Semantic Diff | ${report.probe.behaviorChanged ? '**CONFIRMED — payload changed model verdict**' : 'No behavioral change detected'} |`);
  lines.push(`| Defended Sentinel Probe | ${report.probe.defenseHeld ? `Blocked — returned \`${report.probe.defended.decision}\`` : `BYPASSED — returned \`${report.probe.defended.decision}\``} |`);
  lines.push(`| Overall Status | ${report.status === 'CRITICAL' ? '**CRITICAL — Attack succeeded**' : '**BLOCKED — Defense held**'} |`);
  lines.push('');

  // Pattern matches
  if (report.patternMatches?.length > 0) {
    lines.push('### Injection Patterns Found');
    lines.push('');
    lines.push('| Severity | Line | Pattern | Content |');
    lines.push('|----------|------|---------|---------|');
    for (const m of report.patternMatches.slice(0, 10)) {
      const content = m.lineContent.slice(0, 80).replace(/\|/g, '\\|');
      lines.push(`| ${m.severity} | ${m.lineNumber} | ${m.description} | \`${content}\` |`);
    }
    lines.push('');
  }

  // Probe details
  lines.push('### Live Attack Probe Results');
  lines.push('');

  lines.push('<details>');
  lines.push('<summary>Semantic Diff — payload-stripped vs original</summary>');
  lines.push('');
  lines.push('The same diff was run through GPT-4o twice: once with the full payload, once with all comments and strings stripped.');
  lines.push('');
  if (report.probe.behaviorChanged) {
    lines.push('**Result: BEHAVIORAL MANIPULATION CONFIRMED**');
    lines.push('');
    lines.push(`- With payload: \`${report.probe.undefended.decision}\``);
    lines.push(`- Without payload: \`${report.probe.semantic?.decision}\``);
    lines.push('');
    lines.push('> The payload directly caused the model to change its verdict. This is proof of exploitability, not just pattern detection.');
  } else {
    lines.push(`- With payload: \`${report.probe.undefended.decision}\``);
    lines.push(`- Without payload: \`${report.probe.semantic?.decision}\``);
    lines.push('');
    lines.push('> No behavioral change detected between injected and clean diff.');
  }
  lines.push('</details>');
  lines.push('');

  lines.push('<details>');
  lines.push('<summary>Undefended GPT-4o (no injection awareness)</summary>');
  lines.push('');
  lines.push(`**Decision:** \`${report.probe.undefended.decision}\``);
  lines.push('');
  lines.push(`**Reasoning:** ${report.probe.undefended.reason || 'N/A'}`);
  lines.push('');
  lines.push(report.probe.undefended.fooled
    ? '> The undefended model was successfully manipulated by the injected payload.'
    : '> The undefended model was not fooled by the injection attempt.');
  lines.push('</details>');
  lines.push('');

  lines.push('<details>');
  lines.push('<summary>Defended Sentinel (injection-aware hardened prompt)</summary>');
  lines.push('');
  lines.push(`**Decision:** \`${report.probe.defended.decision}\``);
  lines.push('');
  lines.push(`**Reasoning:** ${report.probe.defended.reason || 'N/A'}`);
  lines.push('');
  lines.push(report.probe.defenseHeld
    ? '> The hardened Sentinel prompt successfully neutralized the injection attempt.'
    : '> The injection bypassed even the hardened Sentinel prompt. This is a critical finding.');
  lines.push('</details>');
  lines.push('');

  // Impact summary
  lines.push('### Impact');
  lines.push('');
  if (report.status === 'CRITICAL') {
    lines.push('This PR contains a **prompt injection attack that successfully manipulated AI-based pipeline analysis**.');
    lines.push('');
    lines.push('- An attacker could use this technique to bypass security gates and ship malicious code undetected');
    lines.push('- The injected payload caused GPT-4o to ignore violations and return an approval');
    lines.push('- **This PR is blocked regardless of its underlying diff content**');
  } else {
    lines.push('This PR contains a **prompt injection attempt that was successfully detected and neutralized** by Sentinel.');
    lines.push('');
    lines.push('- The injection was caught before it could influence the pipeline verdict');
    lines.push('- The hardened Sentinel prompt resisted the manipulation attempt');
    lines.push('- **This PR is blocked because the injection attempt itself is a security violation**');
  }
  lines.push('');
  lines.push(`_Scanned at ${report.scannedAt}_`);

  return lines.join('\n');
}

module.exports = { renderInjectionReport };
