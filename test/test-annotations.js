'use strict';
/**
 * Unit tests for annotation helpers in src/github/checks.js
 *
 * Tests parsePatchLines(), findSnippetInPatch(), and buildAnnotations()
 * in isolation — no GitHub API calls, no external dependencies.
 * buildAnnotations() is called with pre-fetched prFiles to bypass the API.
 */

const { parsePatchLines, findSnippetInPatch, buildAnnotations } = require('../src/github/checks');

const PASS = '✓';
const FAIL = '✗';
let failures = 0;

function assert(condition, label) {
  if (condition) {
    console.log(`  ${PASS} ${label}`);
  } else {
    console.error(`  ${FAIL} FAIL: ${label}`);
    failures++;
  }
}

// ── Sample unified diff patches ────────────────────────────────────────────────

const SIMPLE_PATCH = `@@ -0,0 +1,5 @@
+const express = require('express');
+const pricing = require('./pricing');
+
+const result = FaceMatch_v2.matchFace(userImage);
+biometricVault.storeFaceTemplate(userId, template);`;

const MULTI_HUNK_PATCH = `@@ -1,3 +1,4 @@
 const a = 1;
+const biometricId = getUserBiometric(req.user);
 const b = 2;
 const c = 3;
@@ -10,3 +11,4 @@
 function foo() {
+  const location = user.getLocation('California');
   return true;
 }`;

const CONTEXT_ONLY_PATCH = `@@ -1,3 +1,3 @@
 const a = 1;
-const b = 2;
+const b = 99;
 const c = 3;`;

// ── Tests: parsePatchLines ─────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════');
console.log('  parsePatchLines()');
console.log('══════════════════════════════════════════════════════\n');

// null/undefined input
assert(Array.isArray(parsePatchLines(null)),      'null input returns array');
assert(parsePatchLines(null).length === 0,        'null input returns empty array');
assert(parsePatchLines(undefined).length === 0,   'undefined input returns empty array');
assert(parsePatchLines('').length === 0,           'empty string returns empty array');

// Simple patch: 5 added lines starting at line 1
{
  const lines = parsePatchLines(SIMPLE_PATCH);
  assert(lines.length === 5,                        'simple: 5 added lines parsed');
  assert(lines[0].line === 1,                       'simple: first line is line 1');
  assert(lines[0].content.includes('express'),     'simple: line 1 content correct');
  assert(lines[3].line === 4,                       'simple: 4th entry is line 4');
  assert(lines[3].content.includes('FaceMatch_v2.matchFace'), 'simple: FaceMatch line found at line 4');
  assert(lines[4].line === 5,                       'simple: 5th entry is line 5');
  assert(lines[4].content.includes('biometricVault.storeFaceTemplate'), 'simple: biometric store at line 5');
}

// Multi-hunk patch
{
  const lines = parsePatchLines(MULTI_HUNK_PATCH);
  assert(lines.length === 2,                        'multi-hunk: 2 added lines total');
  assert(lines[0].line === 2,                       'multi-hunk: first add is line 2');
  assert(lines[0].content.includes('biometricId'), 'multi-hunk: biometricId at line 2');
  assert(lines[1].line === 12,                      'multi-hunk: second add is line 12 (hunk at +11, one context line before)');
  assert(lines[1].content.includes('getLocation'), 'multi-hunk: getLocation in second hunk');
}

// Patch with a removal (should not appear in output, but context advances counter)
{
  const lines = parsePatchLines(CONTEXT_ONLY_PATCH);
  assert(lines.length === 1,                        'removal patch: only 1 added line');
  assert(lines[0].line === 2,                       'removal patch: added line is line 2');
  assert(lines[0].content === 'const b = 99;',     'removal patch: replacement content correct');
}

// ── Tests: findSnippetInPatch ──────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════');
console.log('  findSnippetInPatch()');
console.log('══════════════════════════════════════════════════════\n');

const patchLines = parsePatchLines(SIMPLE_PATCH);

// null/empty inputs
assert(findSnippetInPatch(null, patchLines) === null,   'null snippet returns null');
assert(findSnippetInPatch('', patchLines) === null,     'empty snippet returns null');
assert(findSnippetInPatch('foo', []) === null,          'empty patchLines returns null');

// Tier 1: exact substring match
{
  const result = findSnippetInPatch('FaceMatch_v2.matchFace(userImage)', patchLines);
  assert(result !== null,           'tier1: exact match found');
  assert(result.startLine === 4,    'tier1: exact match at line 4');
  assert(result.endLine === 4,      'tier1: endLine === startLine');
}

// Tier 1: partial exact match (a shorter substring)
{
  const result = findSnippetInPatch('biometricVault.storeFaceTemplate', patchLines);
  assert(result !== null,           'tier1: partial exact match found');
  assert(result.startLine === 5,    'tier1: partial exact at line 5');
}

// Tier 2: case-insensitive match
{
  const result = findSnippetInPatch('FACEMATCH_V2.MATCHFACE', patchLines);
  assert(result !== null,           'tier2: case-insensitive match found');
  assert(result.startLine === 4,    'tier2: case-insensitive at line 4');
}

// Tier 3: token match (LLM paraphrases but includes the key identifier)
{
  const result = findSnippetInPatch('storeFaceTemplate()', patchLines);
  // "storeFaceTemplate" is a long enough token (>3 chars) to match tier 3
  assert(result !== null,           'tier3: token match found');
  assert(result.startLine === 5,    'tier3: token match at line 5');
}

// No match at all
{
  const result = findSnippetInPatch('completelyAbsentFunction()', patchLines);
  assert(result === null,           'no match: returns null for absent snippet');
}

// Short tokens below the 3-char threshold should not match on tier 3
{
  const result = findSnippetInPatch('ab cd', patchLines);
  assert(result === null,           'short tokens: no false positive match');
}

// Multi-hunk: verify correct line numbers across hunks
{
  const mlLines = parsePatchLines(MULTI_HUNK_PATCH);
  const r1 = findSnippetInPatch('getUserBiometric', mlLines);
  assert(r1 !== null && r1.startLine === 2,  'multi-hunk: getUserBiometric at line 2');

  const r2 = findSnippetInPatch('getLocation', mlLines);
  assert(r2 !== null && r2.startLine === 12, 'multi-hunk: getLocation at line 12');
}

// ── Tests: buildAnnotations ────────────────────────────────────────────────────

console.log('\n══════════════════════════════════════════════════════');
console.log('  buildAnnotations()');
console.log('══════════════════════════════════════════════════════\n');

// Shared mock PR files (no real GitHub API needed)
const MOCK_FILES = [
  {
    filename: 'src/auth/faceLogin.js',
    status: 'modified',
    patch: `@@ -0,0 +1,4 @@
+const express = require('express');
+const result = FaceMatch_v2.matchFace(userImage);
+biometricVault.storeFaceTemplate(userId, template);
+module.exports = result;`,
  },
  {
    filename: 'src/pricing/dynamic.js',
    status: 'added',
    patch: `@@ -0,0 +1,3 @@
+const price = model.setIndividualPrice(userId);
+const loc = user.getCaliforniaLocation();
+module.exports = { price };`,
  },
  {
    filename: 'src/old-feature.js',
    status: 'removed',
    patch: null,
  },
];

// ── Path A: LLM provided targeted violations ──────────────────────────────────

const VERDICT_WITH_VIOLATIONS = {
  decision: 'BLOCK',
  reasoning: 'Biometric processing without consent.',
  citations: ['[AUTHORITATIVE] BIPA 740 ILCS 14/15(b): requires written consent'],
  jurisdictionBreakdown: [
    { jurisdiction: 'Illinois', decision: 'BLOCK', reason: 'No BIPA consent mechanism' },
    { jurisdiction: 'California', decision: 'BLOCK', reason: 'No CCPA opt-out' },
  ],
  violations: [
    {
      file: 'src/auth/faceLogin.js',
      codeSnippet: 'FaceMatch_v2.matchFace(userImage)',
      jurisdiction: 'Illinois',
      law: 'BIPA §15(b)',
      explanation: 'Biometric matching without written informed consent violates BIPA.',
    },
    {
      file: 'src/pricing/dynamic.js',
      codeSnippet: 'setIndividualPrice(userId)',
      jurisdiction: 'California',
      law: 'CCPA §7030',
      explanation: 'Individualized pricing using PII requires ADMT opt-out mechanism.',
    },
    {
      file: 'src/does-not-exist.js',  // file not in PR — should be skipped
      codeSnippet: 'someFunction()',
      jurisdiction: 'EU',
      law: 'AI Act Art.6',
      explanation: 'Should be silently skipped.',
    },
  ],
};

(async () => {
  // Path A: correct number of annotations, skipping non-PR file
  {
    const anns = await buildAnnotations('tok', 'owner', 'repo', 42, VERDICT_WITH_VIOLATIONS, MOCK_FILES);
    assert(anns.length === 2,                           'pathA: 2 annotations (non-PR file skipped)');
    assert(anns[0].path === 'src/auth/faceLogin.js',   'pathA: first annotation on faceLogin.js');
    assert(anns[0].start_line === 2,                   'pathA: FaceMatch_v2 matched to line 2');
    assert(anns[0].annotation_level === 'failure',     'pathA: BLOCK → failure level');
    assert(anns[0].title.includes('Illinois'),         'pathA: title includes jurisdiction');
    assert(anns[0].title.includes('BIPA'),             'pathA: title includes law');
    assert(anns[0].message.includes('written informed consent'), 'pathA: explanation in message');
    assert(anns[1].path === 'src/pricing/dynamic.js',  'pathA: second annotation on dynamic.js');
    assert(anns[1].start_line === 1,                   'pathA: setIndividualPrice matched to line 1');
    assert(anns[1].title.includes('California'),       'pathA: second title has California');
  }

  // Path A: ESC_HUMAN → warning level
  {
    const escVerdict = { ...VERDICT_WITH_VIOLATIONS, decision: 'ESC_HUMAN' };
    const anns = await buildAnnotations('tok', 'owner', 'repo', 42, escVerdict, MOCK_FILES);
    assert(anns.length === 2,                          'pathA ESC: 2 annotations');
    assert(anns[0].annotation_level === 'warning',     'pathA ESC: ESC_HUMAN → warning level');
  }

  // Path A: snippet not in patch → falls back to firstChangedLine (line 1 for that file)
  {
    const verdictUnmatchable = {
      ...VERDICT_WITH_VIOLATIONS,
      violations: [{
        file: 'src/auth/faceLogin.js',
        codeSnippet: 'thisCodeDoesNotExistAnywhere()',
        jurisdiction: 'EU',
        law: 'AI Act',
        explanation: 'Should still annotate — just on firstChangedLine.',
      }],
    };
    const anns = await buildAnnotations('tok', 'owner', 'repo', 42, verdictUnmatchable, MOCK_FILES);
    assert(anns.length === 1,                          'pathA unmatch: 1 annotation');
    assert(anns[0].start_line === 1,                   'pathA unmatch: falls back to firstChangedLine=1');
  }

  // Path A: all violations reference unknown files → falls through to Path B
  {
    const verdictAllUnknown = {
      ...VERDICT_WITH_VIOLATIONS,
      violations: [{ file: 'ghost.js', codeSnippet: 'x()', jurisdiction: 'CA', law: 'CCPA', explanation: 'test' }],
    };
    const anns = await buildAnnotations('tok', 'owner', 'repo', 42, verdictAllUnknown, MOCK_FILES);
    // Path B kicks in — should annotate the non-removed files (faceLogin.js and dynamic.js)
    assert(anns.length === 2,                          'pathA→pathB fallthrough: 2 file annotations');
    assert(anns[0].title.includes('Argus Compliance Gate'), 'pathA→pathB: generic Path B title');
  }

  // ── Path B: no violations → generic fallback ──────────────────────────────

  const VERDICT_NO_VIOLATIONS = {
    decision: 'BLOCK',
    reasoning: 'Generic block reason.',
    citations: ['[AUTHORITATIVE] CCPA §7030: some text here'],
    jurisdictionBreakdown: [
      { jurisdiction: 'California', decision: 'BLOCK', reason: 'No opt-out' },
    ],
    violations: [],
  };

  {
    const anns = await buildAnnotations('tok', 'owner', 'repo', 42, VERDICT_NO_VIOLATIONS, MOCK_FILES);
    // 2 non-removed files: faceLogin.js and dynamic.js
    assert(anns.length === 2,                          'pathB: 2 annotations (removed file skipped)');
    assert(anns[0].path === 'src/auth/faceLogin.js',  'pathB: first file annotated');
    assert(anns[0].start_line === 1,                  'pathB: starts at firstChangedLine');
    assert(anns[0].title === 'Argus Compliance Gate — BLOCK', 'pathB: generic title');
    assert(anns[0].message.includes('California'),    'pathB: message has jurisdiction reason');
    assert(anns[0].message.includes('CCPA'),          'pathB: message includes citation');
  }

  // Path B: MERGE → always returns empty
  {
    const mergeVerdict = { decision: 'MERGE', violations: [] };
    const anns = await buildAnnotations('tok', 'owner', 'repo', 42, mergeVerdict, MOCK_FILES);
    assert(anns.length === 0,                         'MERGE: empty annotations');
  }

  // Path B: no files → empty annotations
  {
    const anns = await buildAnnotations('tok', 'owner', 'repo', 42, VERDICT_NO_VIOLATIONS, []);
    assert(anns.length === 0,                         'no files: empty annotations');
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  console.log('\n══════════════════════════════════════════════════════');
  if (failures === 0) {
    console.log('  ALL ANNOTATION TESTS PASSED ✓');
  } else {
    console.error(`  ${failures} TEST(S) FAILED`);
    process.exit(1);
  }
  console.log('══════════════════════════════════════════════════════\n');
})();
