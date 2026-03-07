// ══════════════════════════════════════════════════════════════════════════════
// ARGUS — Enterprise Infrastructure Lineage Graph
// Company: "Argus Demo" — a mid-size AI-powered e-commerce & fintech platform
// ══════════════════════════════════════════════════════════════════════════════
// Node labels:  Service · Model · Database · DataProperty
// Edge types:   INVOKES · WRITES_TO · READS_FROM · CONTAINS · SYNCS_TO
// ══════════════════════════════════════════════════════════════════════════════

// ── SERVICES (8) — microservice topology ─────────────────────────────────────
CREATE (auth:Service       {name: 'AuthGateway',        team: 'Platform',   region: 'US',         tier: 'critical',  description: 'OAuth2 / SSO login, biometric MFA'})
CREATE (pricing:Service    {name: 'PricingEngine',      team: 'Revenue',    region: 'US',         tier: 'core',      description: 'Real-time individualized price computation'})
CREATE (surveillance:Service {name: 'SurveillanceAPI',  team: 'Security',   region: 'EU',         tier: 'internal',  description: 'Physical facility access & monitoring'})
CREATE (checkout:Service   {name: 'CheckoutService',    team: 'Commerce',   region: 'US',         tier: 'core',      description: 'Payment processing, cart finalization'})
CREATE (recommend:Service  {name: 'RecommendationAPI',  team: 'Growth',     region: 'US',         tier: 'core',      description: 'Personalized feed & product suggestions'})
CREATE (support:Service    {name: 'CustomerSupportBot', team: 'CX',         region: 'US',         tier: 'external',  description: 'AI chatbot handling customer disputes & refunds'})
CREATE (pipeline:Service   {name: 'DataPipeline',       team: 'DataEng',    region: 'US',         tier: 'internal',  description: 'ETL — syncs user data to analytics warehouses'})
CREATE (adserv:Service     {name: 'AdTargetingService', team: 'Marketing',  region: 'US',         tier: 'external',  description: 'Real-time bid optimization for ad placements'})

// ── AI MODELS (7) — deployed models with risk classification ─────────────────
CREATE (face:Model         {name: 'FaceMatch_v2',            task: 'Facial Recognition',       risk_level: 'High',     version: '2.1.0',  framework: 'PyTorch',    description: 'Biometric face-match for MFA and facility access'})
CREATE (llama:Model        {name: 'Llama_3_Recommender',     task: 'Content Recommendation',   risk_level: 'Medium',   version: '3.2.0',  framework: 'HuggingFace', description: 'Product & content ranking model'})
CREATE (dynprice:Model     {name: 'DynamicPricing_v1',       task: 'Individualized Pricing',   risk_level: 'High',     version: '1.4.2',  framework: 'XGBoost',    description: 'Per-user price discrimination based on browsing & location'})
CREATE (fraud:Model        {name: 'FraudSentinel_v3',        task: 'Fraud Detection',          risk_level: 'High',     version: '3.0.1',  framework: 'TensorFlow', description: 'Real-time transaction fraud scoring — auto-declines above threshold'})
CREATE (chatbot:Model      {name: 'SupportGPT_v1',          task: 'Automated Decision-Making', risk_level: 'High',     version: '1.0.0',  framework: 'OpenAI',     description: 'LLM-powered refund authorization without human review'})
CREATE (adscore:Model      {name: 'AdScore_v2',             task: 'Behavioral Profiling',      risk_level: 'Medium',   version: '2.3.0',  framework: 'LightGBM',   description: 'User interest scoring for ad targeting'})
CREATE (creditai:Model     {name: 'CreditPredict_v1',       task: 'Credit Scoring',            risk_level: 'High',     version: '1.1.0',  framework: 'Scikit',     description: 'Predictive credit-worthiness for BNPL checkout'})

// ── DATABASES (7) — data stores across jurisdictions ─────────────────────────
CREATE (uservault:Database   {name: 'UserVault',           region: 'California',  encryption: 'AES-256',  compliance_scope: 'CCPA',      description: 'Primary user identity & credential store'})
CREATE (publicdb:Database    {name: 'PublicAnalytics',      region: 'EU',          encryption: 'AES-256',  compliance_scope: 'GDPR',      description: 'Anonymized aggregate analytics (GDPR safe)'})
CREATE (marketingdb:Database {name: 'MarketingDB',          region: 'US',          encryption: 'None',     compliance_scope: 'Unclassified', description: 'Ad & campaign targeting — NO encryption (!)'})
CREATE (txndb:Database       {name: 'TransactionLedger',    region: 'California',  encryption: 'AES-256',  compliance_scope: 'CCPA/PCI',  description: 'Payment history, purchase records'})
CREATE (euidentity:Database  {name: 'EU_IdentityStore',     region: 'EU',          encryption: 'AES-256',  compliance_scope: 'GDPR',      description: 'EU resident PII — GDPR Art.17 right-to-delete scope'})
CREATE (biometricvault:Database {name: 'BiometricVault',    region: 'Illinois',    encryption: 'AES-256',  compliance_scope: 'BIPA',      description: 'Biometric templates — Illinois BIPA regulated'})
CREATE (adwarehouse:Database {name: 'AdDataWarehouse',      region: 'US',          encryption: 'TLS-only', compliance_scope: 'FTC',       description: 'Third-party ad exchange data lake'})

// ── DATA PROPERTIES (12) — types of data flowing through the system ──────────
CREATE (biometric:DataProperty    {name: 'Biometric_Hash',     type: 'Biometric',   sensitivity: 'Critical', regulation: 'BIPA §15 / GDPR Art.9'})
CREATE (facetemplate:DataProperty {name: 'FaceTemplate',       type: 'Biometric',   sensitivity: 'Critical', regulation: 'BIPA §15 / EU AI Act Art.5'})
CREATE (email:DataProperty        {name: 'Email',              type: 'PII',         sensitivity: 'High',     regulation: 'CCPA §1798.140 / GDPR Art.4'})
CREATE (location:DataProperty     {name: 'Location',           type: 'PII',         sensitivity: 'High',     regulation: 'CCPA §1798.140 / GDPR Art.4'})
CREATE (browsing:DataProperty     {name: 'BrowsingHistory',    type: 'Behavioral',  sensitivity: 'Medium',   regulation: 'CCPA §7030 ADMT provisions'})
CREATE (anonymous:DataProperty    {name: 'AggregateStats',     type: 'Anonymized',  sensitivity: 'Low',      regulation: 'None (de-identified)'})
CREATE (creditcard:DataProperty   {name: 'CreditCardToken',    type: 'Financial',   sensitivity: 'Critical', regulation: 'PCI-DSS / CCPA'})
CREATE (purchasehx:DataProperty   {name: 'PurchaseHistory',    type: 'Behavioral',  sensitivity: 'Medium',   regulation: 'CCPA §7030'})
CREATE (ipaddress:DataProperty    {name: 'IPAddress',          type: 'PII',         sensitivity: 'Medium',   regulation: 'GDPR Art.4 / CCPA'})
CREATE (creditscore:DataProperty  {name: 'CreditScore',        type: 'Financial',   sensitivity: 'High',     regulation: 'ECOA / FCRA / CCPA'})
CREATE (devicefp:DataProperty     {name: 'DeviceFingerprint',  type: 'PII',         sensitivity: 'High',     regulation: 'ePrivacy / CCPA'})
CREATE (adprofile:DataProperty    {name: 'InterestProfile',    type: 'Behavioral',  sensitivity: 'Medium',   regulation: 'CCPA §7030 / GDPR Art.22'})

// ══════════════════════════════════════════════════════════════════════════════
// EDGES — the data flows that create compliance risk
// ══════════════════════════════════════════════════════════════════════════════

// ── Service → Model  (INVOKES) ───────────────────────────────────────────────
CREATE (auth)-[:INVOKES       {purpose: 'Biometric MFA step-up'}]->(face)
CREATE (surveillance)-[:INVOKES {purpose: 'Facility badge-less entry'}]->(face)
CREATE (pricing)-[:INVOKES    {purpose: 'Compute per-user price'}]->(dynprice)
CREATE (checkout)-[:INVOKES   {purpose: 'Real-time fraud check'}]->(fraud)
CREATE (checkout)-[:INVOKES   {purpose: 'BNPL credit eligibility'}]->(creditai)
CREATE (recommend)-[:INVOKES  {purpose: 'Personalized ranking'}]->(llama)
CREATE (support)-[:INVOKES    {purpose: 'Autonomous refund decisions'}]->(chatbot)
CREATE (adserv)-[:INVOKES     {purpose: 'Ad bid scoring'}]->(adscore)

// ── Model → Database  (WRITES_TO / READS_FROM) ──────────────────────────────

// FaceMatch_v2: reads biometrics from BiometricVault, writes match-results to UserVault
CREATE (face)-[:READS_FROM  {dataFlow: 'face templates for matching'}]->(biometricvault)
CREATE (face)-[:WRITES_TO   {dataFlow: 'match result + confidence'}]->(uservault)
CREATE (face)-[:READS_FROM  {dataFlow: 'user identity lookup'}]->(uservault)

// DynamicPricing_v1: reads user data from UserVault + browsing from MarketingDB
//    DANGEROUS: writes discriminatory prices to MarketingDB (unencrypted!)
CREATE (dynprice)-[:READS_FROM {dataFlow: 'user location + profile'}]->(uservault)
CREATE (dynprice)-[:READS_FROM {dataFlow: 'browsing patterns'}]->(marketingdb)
CREATE (dynprice)-[:WRITES_TO  {dataFlow: 'individualized prices per user'}]->(marketingdb)

// FraudSentinel_v3: reads transactions + writes fraud scores back
CREATE (fraud)-[:READS_FROM {dataFlow: 'transaction history'}]->(txndb)
CREATE (fraud)-[:WRITES_TO  {dataFlow: 'fraud score + auto-decline flag'}]->(txndb)

// CreditPredict_v1: reads purchase history + writes credit scores
//    DANGEROUS: credit decisions on California residents without disclosure
CREATE (creditai)-[:READS_FROM {dataFlow: 'purchase & payment history'}]->(txndb)
CREATE (creditai)-[:WRITES_TO  {dataFlow: 'credit score + BNPL decision'}]->(uservault)

// SupportGPT_v1: reads user info, writes refund decisions
//    DANGEROUS: automated decisions without human-in-the-loop
CREATE (chatbot)-[:READS_FROM  {dataFlow: 'user profile + order history'}]->(uservault)
CREATE (chatbot)-[:READS_FROM  {dataFlow: 'transaction lookup'}]->(txndb)
CREATE (chatbot)-[:WRITES_TO   {dataFlow: 'refund approval/denial + reasoning'}]->(txndb)

// Llama_3_Recommender: reads anonymized analytics (safe path)
CREATE (llama)-[:READS_FROM {dataFlow: 'aggregate user preferences'}]->(publicdb)

// AdScore_v2: reads browsing data, writes interest profiles
//    DANGEROUS: builds behavioral profiles synced to unencrypted ad warehouse
CREATE (adscore)-[:READS_FROM {dataFlow: 'browsing + purchase patterns'}]->(marketingdb)
CREATE (adscore)-[:WRITES_TO  {dataFlow: 'interest profile vectors'}]->(adwarehouse)

// ── Database → DataProperty  (CONTAINS) ─────────────────────────────────────

// UserVault (California) — heavy PII concentration
CREATE (uservault)-[:CONTAINS]->(biometric)
CREATE (uservault)-[:CONTAINS]->(email)
CREATE (uservault)-[:CONTAINS]->(location)
CREATE (uservault)-[:CONTAINS]->(creditscore)
CREATE (uservault)-[:CONTAINS]->(devicefp)

// BiometricVault (Illinois) — BIPA-regulated biometric templates
CREATE (biometricvault)-[:CONTAINS]->(facetemplate)
CREATE (biometricvault)-[:CONTAINS]->(biometric)

// TransactionLedger (California) — financial + behavioral
CREATE (txndb)-[:CONTAINS]->(creditcard)
CREATE (txndb)-[:CONTAINS]->(purchasehx)
CREATE (txndb)-[:CONTAINS]->(ipaddress)

// MarketingDB (US) — unencrypted behavioral data (!)
CREATE (marketingdb)-[:CONTAINS]->(browsing)
CREATE (marketingdb)-[:CONTAINS]->(email)
CREATE (marketingdb)-[:CONTAINS]->(location)

// EU_IdentityStore (EU) — GDPR-scoped PII
CREATE (euidentity)-[:CONTAINS]->(email)
CREATE (euidentity)-[:CONTAINS]->(location)
CREATE (euidentity)-[:CONTAINS]->(ipaddress)

// PublicAnalytics (EU) — clean, anonymized data
CREATE (publicdb)-[:CONTAINS]->(anonymous)

// AdDataWarehouse (US) — behavioral profiles for ad exchange
CREATE (adwarehouse)-[:CONTAINS]->(adprofile)
CREATE (adwarehouse)-[:CONTAINS]->(browsing)
CREATE (adwarehouse)-[:CONTAINS]->(devicefp)

// ── Cross-region data syncs (the hidden compliance landmines) ────────────────
//    DataPipeline ETL copies sensitive data across jurisdictional boundaries

// DANGEROUS: California PII replicated to unencrypted MarketingDB
CREATE (pipeline)-[:INVOKES {purpose: 'Nightly ETL sync'}]->(llama)
CREATE (uservault)-[:SYNCS_TO  {schedule: 'nightly', encryption_in_transit: 'TLS', purpose: 'marketing enrichment'}]->(marketingdb)

// DANGEROUS: EU identity data replicated to US analytics — potential GDPR Art.44 violation
CREATE (euidentity)-[:SYNCS_TO {schedule: 'hourly', encryption_in_transit: 'TLS', purpose: 'unified analytics'}]->(adwarehouse)

// DANGEROUS: Illinois biometrics accessible from California service — BIPA extraterritorial risk
CREATE (biometricvault)-[:SYNCS_TO {schedule: 'real-time', encryption_in_transit: 'mTLS', purpose: 'authentication failover'}]->(uservault)
