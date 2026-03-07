# Integration & Enforcement — Q&A

Answers to: GitHub access, source of truth, conventions, and missing-context enforcement.

---

## 1) What can we access from GitHub right now?

### Currently used

| Data | Source | Where it’s used |
|------|--------|------------------|
| **PR files list** | `GET /repos/:owner/:repo/pulls/:pull_number/files` | `src/github/diff.js` (`fetchPRDiff`), `src/github/checks.js` (`getPRFiles` for annotations) |
| **Diff patches** | Same API — each file object has a `patch` field | Fetched in webhook, attached as `payload._diff`, stored in `ctx.pr.diff`; Stage 2 (Introspect) uses it |
| **PR metadata** | Webhook payload `pull_request` | Stage 1: `id`, `number`, `title`, `body`, `head.sha`, `user.login`, etc. |

So today we **do** fetch the PR file list and diff patches and pass them through the pipeline.

### Not yet used (but easy to add)

| Data | Available? | How |
|------|------------|-----|
| **List of commits in the PR** | **No** — not fetched today | `GET /repos/:owner/:repo/pulls/:pull_number/commits` — would need a new helper (e.g. in `src/github/` or `diff.js`) and to attach the result to `ctx.pr` (e.g. `ctx.pr.commits`) for Stage 2 / adjudication. |
| **Branch name (head)** | **In payload only** — not stored in `ctx` | Webhook payload has `pull_request.head.ref` (e.g. `feat/ARGUS-42-biometric-mfa`). We only persist `pr.head.sha` in Stage 1. Add `headRef: pr.head.ref` (and optionally `baseRef: pr.base.ref`) to `ctx.pr` in `1-intercept.js`. |
| **Base branch name** | **In payload only** — not stored in `ctx` | `pull_request.base.ref` (e.g. `main`). Same as above: add to `ctx.pr` in Intercept. |

**Conclusion:** We already have PR files and diff. We do **not** currently fetch the PR commits list. We **do** have head/base branch names in the webhook payload but do **not** store them in `ctx.pr` yet. Adding branch refs is a one-line change in Intercept; adding commits requires one new API call and wiring into `ctx`.

Branch names and commit messages are strong feature signals (e.g. `feat/<ticket>-<slug>`, “fixes #123”, “CCPA opt-out” in a commit message), so capturing commits + head/base ref is recommended.

---

## 2) Do you have any “source of truth” for features?

**No.** There is no integration with:

- **GitHub Issues**
- **Linear**
- **Jira**
- Any other issue/ticket tracker

So today we have **no** “PR → linked issue/ticket → feature spec” flow. The only structured feature-like input is:

- PR title + body + diff (and optionally jurisdictions from body/keywords).

**Implications:**

- **Best integration** would be: PR → linked issue/ticket → feature spec text (e.g. from Issue body or ticket description). That would give a clear, human-written source of truth for “what this feature is” and “what data/jurisdictions it touches.”
- **Without a tracker**, we can still do **repo-doc discovery** (e.g. scan `/docs/feature/*`, `/rfcs/*`, `.github/PULL_REQUEST_TEMPLATE.md`, or ADRs) and use branch name + commit messages + PR body as signals. That’s weaker than a linked ticket with a spec, but still useful.
- If you later add a tracker (e.g. GitHub Issues or Linear), the best place to plug it in is **Stage 1 (Intercept)** or a small “Stage 0”: resolve “PR → linked issue” (e.g. from “Fixes #123” or a branch name like `ARGUS-42`) and fetch issue body/title to use as feature spec text in Stage 2 and Stage 5.

---

## 3) Do your PRs or branches follow any conventions?

### What the code uses today

- **PR body:** Only one convention is explicitly used — **“Jurisdiction: California, EU”** (and variants like “Jurisdictions: …”). Parsed in Stage 1 for `ctx.jurisdictions`. No other PR template sections are parsed.
- **Branch names:** Not read. (Head/base refs are in the payload but not stored.)
- **Commit messages:** Not fetched, so no convention can be enforced.
- **Repo layout:** No code references folder patterns like `/docs/feature/*`, `/rfcs/*`, or `/adr/*`.

So today: **only the jurisdiction line** is really used as a convention. There are no enforced branch naming, PR template sections, or doc-folder patterns.

### If you add conventions (recommended)

| Convention | Example | How we could use it |
|------------|---------|----------------------|
| **Branch names** | `feat/<ticket-id>-<slug>`, `fix/ARGUS-123-ccpa-optout` | Parse ticket ID from `head.ref`; optionally fetch issue/ticket; use slug as feature hint. |
| **PR template** | Sections: “Feature Summary”, “Data touched”, “Jurisdictions” | Parse sections (e.g. markdown headers or “Jurisdictions: …”) and feed “Data touched” / “Feature Summary” into Stage 2 and Stage 5. |
| **Folder patterns** | `/docs/feature/*`, `/rfcs/*`, `/adr/*` | On PR open, detect changed/added files in those paths; optionally fetch content as feature/ADR context for adjudication. |

If you **do** adopt conventions (e.g. branch naming + PR template), we can harvest high-quality context automatically. If **not**, we can still run with heuristics (keyword scan, LLM from title+body+diff) and optionally ask humans to fill a template; the latter is noisier but still workable.

---

## 4) What’s your intended enforcement behavior when feature context is missing?

**“Feature context”** here means: enough signal to understand what the PR does and what data/jurisdictions it touches — e.g. from PR body, linked issue, branch name, commit messages, or repo docs. “Missing” = none of that is present or it’s too vague (e.g. “fix stuff”, no jurisdictions, no linked issue).

### Current behavior

There is **no** explicit “missing context” rule in the pipeline. In practice:

- Stage 1 defaults jurisdictions to `["California", "EU"]` when nothing is found.
- Stage 2 infers task type and implied jurisdictions from title + body + diff (or falls back to “Unknown” on OpenAI failure).
- Stage 5 adjudicates on whatever is in the brief; it doesn’t have a dedicated “context missing → force ESC_HUMAN” rule.

So today we **don’t** consistently escalate when context is missing; we still run and may MERGE or BLOCK.

### Choose one enforcement rule

Pick a single policy and we can wire it into Stage 5 (and optionally Stage 1/2) so that “missing context” is handled consistently:

| Option | Behavior | Use case |
|--------|----------|----------|
| **A) Warn only** | Log a warning; still run full pipeline and allow MERGE/BLOCK/ESC_HUMAN based only on existing evidence. | Maximize automation; accept that some MERGEs may be under-informed. |
| **B) ESC_HUMAN only for high-risk tasks** | If context is missing **and** the task is high-risk (e.g. Biometric, PII, Individualized Pricing, Automated Decision-Making), force verdict to **ESC_HUMAN**. Otherwise allow normal decision. | **Recommended:** balances automation with safety on the riskiest work. |
| **C) Always ESC_HUMAN when context missing** | Any time we consider “feature context” insufficient, set verdict to **ESC_HUMAN** regardless of task type. | Strictest; can be annoying for low-risk PRs with minimal description. |

**Recommendation:** **B) ESC_HUMAN only for high-risk tasks when context is missing.** That way:

- Low-risk or clearly documented PRs can still get MERGE without extra friction.
- High-risk work without clear context (no jurisdictions, no linked issue, vague description) gets human review by default.

Implementing this would require:

1. **Defining “context missing”** (e.g. no explicit jurisdictions and no linked issue and task type “Unknown” or high-risk; or a dedicated “context quality” flag from Stage 1/2).
2. **Defining “high-risk task”** (e.g. list: Biometric Processing, Facial Recognition, Individualized Pricing, Automated Decision-Making, Credit Scoring, etc. — can align with `TASK_JURISDICTION_MAP` or adjudication rules).
3. **In Stage 5 (or in the webhook after pipeline):** if “context missing” and “high-risk task”, override verdict to `ESC_HUMAN` and optionally add a recommendation like “Add jurisdiction and feature summary to the PR or link an issue.”

Once you choose A, B, or C, we can document it as the intended behavior and implement the corresponding logic.
