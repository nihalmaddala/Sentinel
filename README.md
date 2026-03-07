# Argus

**Autonomous Multi-Regime Compliance Gatekeeper for AI Systems**

Argus is a GitHub App that acts as an automated merge gate in the CI/CD pipeline. It intercepts Pull Requests, identifies jurisdiction-specific regulatory risks across multiple legal regimes (EU AI Act, CCPA 2026, GDPR, Illinois BIPA, and others), traces data flows through an infrastructure knowledge graph, and autonomously blocks or approves merges based on combined legal and architectural reasoning.

---

## The Problem

Engineers ship AI features in minutes. Regulatory law is a fragmented global patchwork. A pricing model that is perfectly legal in Texas may violate California's 2026 ADMT rules. A facial recognition feature compliant in the US may be banned under the EU AI Act. By the time a legal team reviews the feature, it is already deployed.

Argus closes this gap by moving compliance left -- acting as a jurisdiction-aware guardian that evaluates every PR before it reaches production.

---

## How It Works

Argus operates as a 6-stage autonomous state machine triggered by GitHub webhook events.

```
PR Opened ──> [1] Intercept ──> [2] Introspect ──> [3] Research ──> [4] Trace ──> [5] Adjudicate ──> [6] Enforce
                  Webhook          OpenAI             Tavily          Neo4j          OpenAI            GitHub API
```

| Stage | Name | Tool | Action |
|-------|------|------|--------|
| 1 | **Intercept** | Webhook | Receives PR data, extracts metadata, detects target jurisdictions |
| 2 | **Introspect** | OpenAI (GPT-4o) | Classifies technical intent -- task type, risk indicators, models mentioned |
| 3 | **Research** | Tavily | Live-searches multi-regime laws (EU AI Act, CCPA 2026, GDPR, BIPA) |
| 4 | **Trace** | Neo4j | Queries the infrastructure lineage graph for PII/biometric data flow paths |
| 5 | **Adjudicate** | OpenAI (GPT-4o) | Synthesizes law + graph evidence + intent into a cited risk verdict |
| 6 | **Enforce** | GitHub Checks API | Resolves the PR check as MERGE, BLOCK, or ESCALATE TO HUMAN |

When a developer opens a PR, Argus immediately creates a **pending check** on the commit, visually locking the merge button. After the pipeline completes, the check resolves to green (compliant) or red (violation detected), with a detailed audit report posted as a PR comment.

---

## Architecture

```
                         +------------------+
                         |   GitHub App     |
                         |   (Webhook)      |
                         +--------+---------+
                                  |
                                  v
                         +------------------+
                         |  Express Server  |
                         |  HMAC Verified   |
                         +--------+---------+
                                  |
                    +-------------+-------------+
                    |             |              |
                    v             v              v
              +-----------+ +-----------+ +-----------+
              |  OpenAI   | |  Tavily   | |  Neo4j    |
              |  GPT-4o   | |  Search   | |  AuraDB   |
              +-----------+ +-----------+ +-----------+
              Intent         Live Legal    Infrastructure
              Classification Citations     Lineage Graph
                    |             |              |
                    +-------------+-------------+
                                  |
                                  v
                         +------------------+
                         |   Adjudication   |
                         |   Engine         |
                         +--------+---------+
                                  |
                         +--------+---------+
                         | GitHub Checks &  |
                         | Comments API     |
                         +------------------+
```

---

## Infrastructure Lineage Graph (Neo4j)

The knowledge graph models a realistic enterprise microservice topology for a company called "Argus Demo" -- an AI-powered e-commerce and fintech platform. This is what differentiates Argus from tools that simply chat with regulatory PDFs: the graph provides **deterministic, verifiable evidence** of where data actually flows.

### Graph Structure

**34 Nodes / 48 Relationships**

| Node Label | Count | Description |
|------------|-------|-------------|
| Service | 8 | Microservices (AuthGateway, PricingEngine, CheckoutService, etc.) |
| Model | 7 | Deployed AI models (FaceMatch_v2, DynamicPricing_v1, FraudSentinel_v3, etc.) |
| Database | 7 | Data stores across jurisdictions (UserVault/CA, BiometricVault/IL, EU_IdentityStore/EU) |
| DataProperty | 12 | Data types (Biometric_Hash, CreditCardToken, Email, Location, BrowsingHistory, etc.) |

| Relationship | Count | Meaning |
|--------------|-------|---------|
| INVOKES | 9 | Service calls an AI model |
| READS_FROM | 10 | Model reads from a database |
| WRITES_TO | 6 | Model writes to a database |
| CONTAINS | 20 | Database stores a data property |
| SYNCS_TO | 3 | Cross-region data replication (compliance landmines) |

### Cross-Region Data Flows

These are the hidden compliance risks the graph exposes:

| Source | Destination | Risk |
|--------|-------------|------|
| UserVault [California] | MarketingDB [US] | California PII synced to an **unencrypted** marketing database |
| EU_IdentityStore [EU] | AdDataWarehouse [US] | GDPR-protected data transferred to US ad exchange (Art.44 violation) |
| BiometricVault [Illinois] | UserVault [California] | Illinois BIPA biometrics crossing state lines |

### Example Trace Query

When a PR mentions `DynamicPricing_v1`, Argus runs:

```cypher
MATCH (m:Model {name: 'DynamicPricing_v1'})
      -[:WRITES_TO|READS_FROM*1..5]->
      (db:Database)-[:CONTAINS]->(p:DataProperty)
WHERE p.type IN ['Biometric', 'PII', 'Financial']
RETURN m, db, p
```

Against the Argus Demo graph, this returns 11 lineage paths, revealing that the pricing model reads from UserVault (California) and writes to MarketingDB (unencrypted), touching Biometric, PII, Financial, and Behavioral data.

**Important distinction:** The query logic is fully generic. The results are determined entirely by what is in the graph. The Argus Demo topology is a reference implementation for demonstration purposes. In production, a company seeds the graph with a map of their own services, models, databases, and data flows. Argus then traverses that company-specific graph at runtime. The system does not hardcode any company's infrastructure -- it reasons over whatever topology has been loaded into Neo4j.

---

## Technical Stack

| Component | Technology | Purpose |
|-----------|-----------|---------|
| Runtime | Node.js 18+ / Express | Webhook server and pipeline orchestrator |
| Integration | GitHub App (Octokit) | Webhook events, Checks API, PR comments |
| Classification | OpenAI GPT-4o | Intent extraction and risk adjudication |
| Legal Research | Tavily API | Live regulatory search with citation retrieval |
| Knowledge Graph | Neo4j AuraDB | Infrastructure lineage tracing |
| Deployment | Render | Cloud hosting with environment configuration |

---

## Project Structure

```
AutonomousAgents/
  src/
    index.js                    # Express server, raw body parsing, route mounting
    config/
      index.js                  # Environment validation, frozen config objects
    services/
      openai.js                 # OpenAI client singleton
      tavily.js                 # Tavily client with graceful degradation
      neo4j.js                  # Neo4j driver, runQuery() helper
    github/
      auth.js                   # JWT generation, installation token exchange
      checks.js                 # Checks API: create pending, resolve with verdict
      comments.js               # Post audit report as PR comment
      webhook.js                # HMAC-SHA256 verification, event routing
    pipeline/
      index.js                  # Sequential orchestrator (stages 1-6)
      1-intercept.js            # Parse payload, detect jurisdictions
      2-introspect.js           # GPT-4o intent classification
      3-research.js             # Tavily multi-regime legal search
      4-trace.js                # Neo4j lineage graph traversal
      5-adjudicate.js           # GPT-4o risk synthesis and scoring
      6-enforce.js              # Final verdict logging and context population
  neo4j/
    seed.cypher                 # Infrastructure lineage graph definition
    seed.js                     # Graph seeding runner script
  test/
    mock-payload.json           # Realistic GitHub webhook payload
    test-pipeline.js            # End-to-end pipeline test (stages 1-6)
    test-stages-1-4.js          # Incremental stage validation
    test-webhook.js             # Local webhook POST with HMAC signing
    test-neo4j-queries.js       # Neo4j graph query verification
  render.yaml                   # Render deployment configuration
  package.json
```

---

## Setup

### Prerequisites

- Node.js 18 or higher
- A registered GitHub App with webhook permissions
- OpenAI API key (GPT-4o access)
- Tavily API key (optional -- degrades gracefully)
- Neo4j AuraDB instance (optional -- falls back to static evidence)

### Installation

```bash
git clone https://github.com/chanu1406/AutonomousAgents.git
cd AutonomousAgents
npm install
```

### Environment Variables

Create a `.env` file in the project root:

```env
# GitHub App
GITHUB_APP_ID=<your-app-id>
GITHUB_CLIENT_ID=<your-client-id>
GITHUB_CLIENT_SECRET=<your-client-secret>
GITHUB_WEBHOOK_SECRET=<your-webhook-secret>
GITHUB_PRIVATE_KEY_PATH=<path-to-pem-file>

# Server
PORT=3000
WEBHOOK_PATH=/api/webhook

# Smee (local development webhook proxy)
SMEE_URL=<your-smee-channel-url>

# OpenAI
OPENAI_API_KEY=<your-openai-key>

# Tavily (optional)
TAVILY_API_KEY=<your-tavily-key>

# Neo4j (optional)
NEO4J_URI=<neo4j+s://xxxxx.databases.neo4j.io>
NEO4J_USERNAME=neo4j
NEO4J_PASSWORD=<your-neo4j-password>
```

### Seed the Neo4j Graph

```bash
npm run seed
```

This populates the graph with 34 nodes and 48 relationships representing the Argus Demo enterprise infrastructure.

### Start the Server

```bash
# Production
npm start

# Development (with Smee webhook proxy)
npm run dev
```

---

## Usage

### Automated (GitHub Webhook)

1. Install the Argus GitHub App on a repository.
2. Open a Pull Request. Include jurisdiction context in the PR body:
   ```
   Jurisdiction: California, EU
   ```
3. Argus creates a pending check, runs the 6-stage pipeline, and resolves the check with a verdict.

### Manual Testing

Send a mock webhook payload to the local server:

```bash
npm run test:webhook
```

Run the pipeline tests:

```bash
node test/test-pipeline.js
node test/test-stages-1-4.js
```

Verify the Neo4j graph:

```bash
node test/test-neo4j-queries.js
```

---

## Graceful Degradation

Argus is designed to function at varying capability levels depending on available credentials:

| Component | Available | Degraded |
|-----------|-----------|----------|
| Stages 1, 6 (Intercept, Enforce) | Always functional | -- |
| Stage 2 (Introspect) | Full GPT-4o classification | Falls back to keyword-based classification |
| Stage 3 (Research) | Live Tavily legal search | Returns curated static citations (CCPA, EU AI Act, GDPR, BIPA) |
| Stage 4 (Trace) | Live Neo4j graph traversal | Returns static evidence based on known seed graph topology |
| Stage 5 (Adjudicate) | Full GPT-4o synthesis | Deterministic rule-based scoring without LLM |

---

## Supported Jurisdictions

| Jurisdiction | Key Regulations | Risk Triggers |
|-------------|----------------|---------------|
| California | CCPA 2026, ADMT rules (Section 7030) | Automated decision-making, individualized pricing, PII processing |
| European Union | EU AI Act (Art. 5, 6, 9), GDPR (Art. 4, 9, 22, 44) | High-risk AI classification, biometric processing, cross-border transfers |
| Illinois | BIPA (Section 15) | Biometric data collection, face templates, consent requirements |
| United Kingdom | UK GDPR, AI regulatory framework | Automated profiling, data adequacy |
| New York | NYC Local Law 144 | Automated employment decision tools |
| Texas | TDPSA | Consumer data processing |

---

## Verdict Output

The adjudication engine produces a structured verdict:

```json
{
  "decision": "BLOCK",
  "overallScore": 0.85,
  "legalRisk": 0.9,
  "architecturalExposure": 0.8,
  "reasoning": "DynamicPricing_v1 processes California resident PII for individualized pricing without required ADMT opt-out mechanism...",
  "citations": [
    "CCPA Section 7030: Businesses using ADMT must provide opt-out...",
    "EU AI Act Article 6: High-risk AI systems require conformity assessment..."
  ],
  "recommendations": [
    "Add opt-out toggle for California users before merge",
    "Conduct ADMT risk assessment per CCPA Section 7030",
    "Encrypt MarketingDB at rest (currently unencrypted)"
  ]
}
```

| Decision | Threshold | Action |
|----------|-----------|--------|
| MERGE | overallScore < 0.40 | Check resolves green. Merge permitted. |
| ESC_HUMAN | 0.40 <= overallScore < 0.65 | Check marked for review. Human approval required. |
| BLOCK | overallScore >= 0.65 | Check resolves red. Merge blocked. Audit report posted. |

---

## Deployment

### Render

The included `render.yaml` configures deployment on Render's free tier. Set all environment variables in the Render dashboard, then deploy from the GitHub repository.

### Webhook Configuration

After deployment, update the GitHub App's webhook URL from the Smee proxy to the production endpoint:

```
https://<your-render-app>.onrender.com/api/webhook
```

---

## LLM Provider: OpenAI vs OpenRouter

Argus ships with a unified LLM wrapper (`src/llm/client.js`) that supports both **OpenAI direct** and **OpenRouter** with a single env-var toggle.

### Default: OpenAI direct

Set your key and you're done:

```env
OPENAI_API_KEY=sk-proj-...
```

### Switch to OpenRouter

Set one secret — nothing else:

```env
OPENROUTER_API_KEY=sk-or-v1-...
```

When `OPENROUTER_API_KEY` is present the server automatically routes all LLM calls through `https://openrouter.ai/api/v1`. No code changes required.

### Optional overrides

```env
# Force a specific provider (auto-detected when OPENROUTER_API_KEY is set)
LLM_PROVIDER=openrouter          # or "openai"

# Model IDs (OpenRouter-style IDs work for both providers)
LLM_MODEL_MAIN=openai/gpt-4o            # Stage 5 Pass 2 — final adjudication
LLM_MODEL_MINI=openai/gpt-4o-mini       # Stage 2 + Stage 5 Pass 1 — classification/draft
LLM_MODEL_EXTRACTOR=qwen/qwen3-235b-a22b  # structured-extraction sub-agent (future)

# OpenRouter branding headers (informational, sent to OpenRouter for attribution)
OPENROUTER_REFERER=https://your-app.com
OPENROUTER_APP_NAME=Argus

# Dev only — log full prompts (NEVER enable in production)
LLM_LOG_PROMPTS=false
```

### Model mapping examples

| Use-case | OpenAI direct | OpenRouter |
|----------|--------------|------------|
| Main adjudication | `gpt-4o` | `openai/gpt-4o` |
| Classification / draft | `gpt-4o-mini` | `openai/gpt-4o-mini` |
| Cheap extractor | — | `qwen/qwen3-235b-a22b` |
| Reasoner | — | `anthropic/claude-3.5-sonnet` |

### LLM health check

```bash
# While the server is running:
curl http://localhost:3000/api/llm/health

# Expected response:
# { "provider": "openrouter", "model": "openai/gpt-4o-mini", "ok": true, "latency_ms": 432 }
```

### Smoke test (no server required)

```bash
npm run llm:smoke
```

Sends two test calls (raw + JSON-schema) directly against the configured provider and reports pass/fail with latency. Exit code 0 = success.

---

## License

MIT

# test


