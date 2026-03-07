# Expansion Opportunities

## What Was Done

- **`npm install`** was run. All dependencies in `package.json` are now in `node_modules`, including **`@tavily/core`** (and `openai`, `neo4j-driver`, `express`, etc.). The earlier "Cannot find module '@tavily/core'" error was from missing `node_modules`, not from the package list.
- To run the full pipeline locally you still need a `.env` with at least: `GITHUB_APP_ID`, `GITHUB_WEBHOOK_SECRET`, `OPENAI_API_KEY`. Optional: `TAVILY_API_KEY`, `NEO4J_URI`, `NEO4J_USERNAME`, `NEO4J_PASSWORD`.

---

## Changes You Can Expand

Below are concrete expansion ideas, grouped by area. Pick what fits your roadmap.

---

### 1. Feature context layer (already in place — can extend)

- **More doc paths**  
  In `src/pipeline/0-feature-context.js`, `DOC_PATH_PREFIXES` is `['docs/', 'rfc/', 'adr/', '.github/']`. Add more (e.g. `specs/`, `design/`, `compliance/`) if your repo uses them.

- **Richer headline from branch**  
  `headlineFromBranch()` only strips a few prefixes and ticket IDs. You could add support for more patterns (e.g. `jira-PROJ-123-slug`) or take the first line of the PR body as a “subtitle” and append it to the headline in the brief.

- **Commit message quality**  
  `meaningfulCommitMessages()` filters trivial messages. You could score commits (e.g. length, presence of “fixes #N”, “jurisdiction”, “PII”) and pass a “commit quality” flag or count into `ctx.feature` for Stage 5.

- **Fetch full doc file content**  
  Right now doc snippets come only from the **patch** of changed files. You could add a GitHub helper to fetch the **full file content** for paths under `docs/` (or `rfc/`, `adr/`) and append a truncated version to `docSnippets`, with a safe cap (e.g. 5 KB total) and graceful failure.

---

### 2. GitHub integration

- **PR → linked issue**  
  Parse “Fixes #123” / “Closes #45” (and similar) from the PR body or commit messages; call GitHub’s “list issues for a repo” or “get issue” to fetch the issue body and use it as **feature spec text** in Stage 2 and in the compliance brief. That gives a clear “source of truth” per PR.

- **Branch naming conventions**  
  You already have `headRef` / `baseRef`. Add a small parser (e.g. `feat/<ticket>-<slug>`, `fix/<ticket>-<slug>`) and put `ticketId` and `slug` on `ctx.feature` so Stage 2 and Stage 5 can reference “this PR is for ticket X”.


---

### 3. Source of truth (tracker) integration

- **GitHub Issues**  
  Use the “linked issue” flow above: resolve issue number from PR, fetch issue body/title, and add an “Issue / feature spec” section to the introspect prompt and compliance brief.

- **Linear / Jira / etc.**  
  If you adopt a tracker, add a small client (e.g. `src/integrations/linear.js`) that, given a ticket ID from the branch or PR body, fetches the ticket description and (optionally) status. Same idea: feed that text into `ctx.feature` (e.g. `ctx.feature.trackerSpec`) and into Stage 2 and Stage 5. Keep it optional so the pipeline still runs without a tracker.

---

### 4. Conventions and templates

- **PR template parsing**  
  If the repo uses a PR template with sections like “Feature Summary”, “Data touched”, “Jurisdictions”, add a small parser (regex or markdown headers) to extract those sections into `ctx.feature` (e.g. `ctx.feature.prSections`) and include them in the introspect user message and compliance brief.

- **Convention checks**  
  Optionally add a “convention compliance” step (e.g. after feature context): if “Jurisdictions” is required but missing, set a flag or append to `recommendations` (“Add a Jurisdictions section to the PR description”) without changing the verdict by itself.

---

### 5. Enforcement and policy

- **Option A or C**  
  You implemented **Option B** (ESC_HUMAN only for high-risk when context is missing). You could add a config flag (e.g. `ENFORCEMENT_MISSING_CONTEXT=warn|option_b|always_escalate`) and implement Option A (warn only) or Option C (always ESC_HUMAN when context missing).

- **Configurable high-risk list**  
  Move `HIGH_RISK_TASKS` in `5-adjudicate.js` to config (or env: `ARGUS_HIGH_RISK_TASKS=Biometric Processing,Facial Recognition,...`) so teams can tune without code changes.

- **Per-repo or per-org policy**  
  If you support multiple repos/orgs, store policy in a config file in the repo (e.g. `.argus/policy.json`) or in a database keyed by repo/org, and read “high-risk list” and “missing-context behavior” from there.

---

### 6. Observability and tests

- **Structured logging**  
  Add a small logger that emits JSON (e.g. `{ stage, prNumber, durationMs, contextQuality, decision }`) so you can ship logs to Datadog, Splunk, or BigQuery and analyze false MERGEs / false ESCALATEs.

- **Pipeline tests with mocks**  
  Add tests that mock OpenAI, Tavily, and Neo4j (e.g. with `nock` or dependency injection) so `test-pipeline.js` (or a new `test-pipeline-full.js`) runs the full 6 stages + feature context without real API keys and asserts on `ctx.verdict.decision` and `ctx.feature.contextQuality`.

- **Regression suite**  
  Keep a set of “golden” PR payloads (e.g. one that should MERGE, one BLOCK, one ESC_HUMAN) and run the pipeline against them in CI; fail if the decision or key reasoning changes unexpectedly.

---

### 7. Neo4j and lineage

- **Larger or real topology**  
  The current `seed.cypher` is a demo graph. You can expand it with more services, models, and regions, or replace it with a script that imports your real topology from another system (e.g. CMDB, service catalog).

- **Cross-region rules**  
  Stage 4 already exposes cross-region paths. You could add explicit “forbidden flows” (e.g. EU PII → US ad warehouse) and have Stage 5 treat those as a BLOCK or mandatory ESC_HUMAN regardless of other scores.

---

### 8. Legal and research

- **More jurisdictions**  
  Add more entries to `JURISDICTION_PATTERNS` in `1-intercept.js` and to the research/adjudication logic (e.g. Canada, Australia, Brazil) and extend `AUTHORITATIVE_DOMAINS` and static citations in `3-research.js` for those regions.

- **Tavily depth**  
  In `3-research.js` you use `searchDepth: 'advanced'` and a couple of queries per jurisdiction. You could add more queries per jurisdiction or a “deep research” mode (e.g. when `contextQuality === 'low'`) to pull more citations before adjudication.

---

## Summary

- **Install:** `npm install` fixed the missing `@tavily/core` (and other) modules; no need to add new packages for the current plan.
- **Expand:** You can extend feature context (doc paths, headline, commits, full file fetch), GitHub (linked issues, branch parsing, events), a tracker (Issues, Linear, Jira), PR templates, enforcement options, configurable policy, observability, tests, Neo4j topology, and jurisdictions/research depth—incrementally and without breaking the existing 6-stage + feature-context design.
