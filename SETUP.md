# Sentinel — Backend Setup for Teammates

## What this repo is
Sentinel is the GitHub App / security agent backend. It watches the **lolitos repo** (`nihalmaddala/hackformerced-test`) for new PRs, scans the diff for prompt injection attacks, and posts the result as a GitHub check + comment.

---

## Prerequisites
- Node.js 18+
- Access to the shared `.env` values (get from Saketh)
- The GitHub App `.pem` private key file (get from Saketh — `argus-security-linter.2026-03-06.private-key.pem`)

---

## Step 1 — Clone & install

```bash
git clone https://github.com/nihalmaddala/hackmerced.git
cd hackmerced
git checkout sakdev        # ← the working branch with all injection scanner code
npm install
```

---

## Step 2 — Set up `.env`

```bash
cp .env.example .env
```

Then fill in the values — get them from Saketh:

| Variable | What it is |
|---|---|
| `OPENAI_API_KEY` | OpenAI key — needed for the live GPT-4o probe |
| `TAVILY_API_KEY` | Tavily search — used by the research stage |
| `GITHUB_APP_ID` | The Sentinel GitHub App ID |
| `GITHUB_WEBHOOK_SECRET` | Must match the secret set in the GitHub App settings |
| `GITHUB_PRIVATE_KEY_PATH` | Path to the `.pem` file Saketh gives you |
| `SUPABASE_URL` / `SUPABASE_KEY` | Optional — verdict persistence (non-fatal if missing) |
| `NEO4J_URI` etc. | Optional — graph evidence (non-fatal if missing) |

Place the `.pem` file in the root of the repo (same folder as `package.json`).

---

## Step 3 — Start the backend

```bash
npm start
# Server runs on http://localhost:3000
```

You should see:
```
[config] Private key loaded from file: ./argus-security-linter...pem
[llm] Provider: openai | main=gpt-4o | mini=gpt-4o-mini
[server] Sentinel listening on port 3000
```

---

## Step 4 — Expose the server via smee (for GitHub webhooks)

GitHub needs to reach your local server. We use smee.io as a tunnel.

```bash
npm run dev
```

This starts both the server AND the smee tunnel in parallel. The smee URL is already configured in the GitHub App to forward webhooks here.

> **Note:** Only one person should run the backend at a time, otherwise both machines will process the same webhook.

---

## Step 5 — Trigger the demo

Go to the **lolitos repo** (`nihalmaddala/hackformerced-test`) and open a PR on any branch that has injection payloads in the diff.

Sentinel will:
1. Receive the webhook
2. Run the injection scanner (Layer 1 patterns + Layer 2 live GPT-4o probe)
3. Post a **GitHub Check** (BLOCK/PASS) on the PR
4. Post a **GitHub Comment** with the full injection scan report

You'll see the check turn red and the comment appear on the PR within ~10 seconds.

---

## Step 6 — Test locally without GitHub (optional)

Run the standalone demo — no server needed:

```bash
npm run demo              # Clean PR + all 3 attacks
npm run demo:attack1      # Attack 1: Fake Pre-Approval Metadata
npm run demo:attack2      # Attack 2: Embedded JSON Verdict Injection
npm run demo:attack3      # Attack 3: Role Reassignment via JSDoc
```

Or fire a real webhook at the local server:

```bash
# In one terminal:
npm start

# In another terminal:
npm run test:injection          # Injected PR
npm run test:injection:clean    # Clean PR
```

---

## How the injection scanner works

```
PR diff
  │
  ├─ Layer 1: Pattern scan (regex)
  │    30+ known injection patterns (CRITICAL / HIGH)
  │    Fast — no LLM call
  │
  └─ Layer 2: Live GPT-4o probe
       ┌─ Undefended probe (vanilla prompt) → does naive GPT-4o get fooled?
       └─ Defended probe (hardened Sentinel prompt) → does defense hold?

Result: CLEAN | BLOCKED | CRITICAL
```

**The demo narrative:**
- Without Sentinel: a naive AI reviewer gets fooled by the injection and returns MERGE ✗
- With Sentinel: the hardened prompt detects manipulation and returns BLOCK ✓

---

## Key files

| File | What it does |
|---|---|
| `src/attacker/injection-scanner.js` | Two-layer injection scanner |
| `src/attacker/injection-report.js` | Renders the GitHub PR comment |
| `src/pipeline/index.js` | Wires scanner into the pipeline |
| `src/github/webhook.js` | Receives GitHub webhooks |
| `test/demo.js` | Standalone demo (no server needed) |
| `test/test-injection.js` | Fires webhook at local server |
