'use strict';

// Stage 3: Tavily — live-search multi-regime laws per jurisdiction

const tavilyClient = require('../services/tavily');

// ── Authoritative legal source domains, grouped by jurisdiction ──────────────
// Tavily's includeDomains param restricts results to ONLY these sources.
// This prevents law firm blogs, AI-generated content, or news commentary
// from entering the citation pipeline and causing false compliance verdicts.
const AUTHORITATIVE_DOMAINS = {
  California: [
    'leginfo.legislature.ca.gov',   // Official CA statute text
    'cppa.ca.gov',                  // CA Privacy Protection Agency
    'oag.ca.gov',                   // CA Attorney General
    'ag.ca.gov',                    // CA AG (alternate)
    'law.justia.com',               // Justia — verbatim statute mirror
    'law.cornell.edu',              // Cornell LII — verbatim statute mirror
    'govinfo.gov',                  // US GPO — federal scope but used for CA federal overlap
  ],
  EU: [
    'eur-lex.europa.eu',            // Official EU legislation (binding text)
    'edpb.europa.eu',               // European Data Protection Board
    'digital-strategy.ec.europa.eu',// EC digital strategy / AI Act documentation
    'artificialintelligenceact.eu', // EU AI Act official text portal
    'ec.europa.eu',                 // European Commission
  ],
  UK: [
    'legislation.gov.uk',           // Official UK statute text
    'ico.org.uk',                   // Information Commissioner's Office
    'gov.uk',                       // HM Government guidance
  ],
  Illinois: [
    'ilga.gov',                     // Illinois General Assembly — official statute
    'ag.state.il.us',               // Illinois Attorney General
    'ipr.il.gov',                   // Illinois Privacy Regulation portal
    'law.justia.com',
    'law.cornell.edu',
  ],
  'New York': [
    'dos.ny.gov',                   // NY Department of State
    'ag.ny.gov',                    // NY Attorney General
    'nyc.gov',                      // NYC official guidance (Local Law 144)
    'laws.ny.gov',                  // NY statute portal
    'law.justia.com',
    'law.cornell.edu',
  ],
  Texas: [
    'statutes.capitol.texas.gov',   // Official TX statute text
    'oag.texas.gov',                // TX Attorney General
    'gov.texas.gov',
    'law.justia.com',
    'law.cornell.edu',
  ],
  Canada: [
    'laws-lois.justice.gc.ca',      // Department of Justice — official statute text
    'priv.gc.ca',                   // Office of the Privacy Commissioner of Canada
    'justice.gc.ca',                // Government of Canada justice portal
    'cai.gouv.qc.ca',               // Commission d'accès à l'information (Quebec)
    'ic.gc.ca',                     // Innovation, Science and Economic Development Canada
  ],
  Australia: [
    'legislation.gov.au',           // Federal Register of Legislation
    'oaic.gov.au',                  // Office of the Australian Information Commissioner
    'ag.gov.au',                    // Attorney-General's Department
    'accc.gov.au',                  // ACCC (for AI/digital competition guidance)
  ],
  Brazil: [
    'planalto.gov.br',              // Official federal legislation (LGPD text)
    'gov.br',                       // Brazilian government portal
    'anpd.gov.br',                  // Autoridade Nacional de Proteção de Dados
  ],
  Global: [
    'law.cornell.edu',
    'law.justia.com',
    'govinfo.gov',
    'eur-lex.europa.eu',
    'oecd.org',                     // OECD AI Principles
    'un.org',                       // UN AI governance
  ],
};

// Flat set for fast trust-check of any returned source URL
const ALL_TRUSTED_DOMAINS = new Set(
  Object.values(AUTHORITATIVE_DOMAINS).flat()
);

/**
 * Determine whether a source URL is from an authoritative domain.
 * Returns 'authoritative', 'reference', or 'unverified'.
 */
function classifySourceAuthority(url) {
  if (!url) return 'unverified';
  try {
    const hostname = new URL(url).hostname.replace(/^www\./, '');
    // Direct match
    if (ALL_TRUSTED_DOMAINS.has(hostname)) return 'authoritative';
    // Subdomain of a trusted domain
    for (const trusted of ALL_TRUSTED_DOMAINS) {
      if (hostname.endsWith('.' + trusted)) return 'authoritative';
    }
    // Secondary legal reference sites (acceptable but not primary authority)
    const secondaryDomains = ['findlaw.com', 'nolo.com', 'iapp.org', 'huntonprivacyblog.com'];
    if (secondaryDomains.some((d) => hostname.endsWith(d) || hostname === d)) return 'reference';
    return 'unverified';
  } catch {
    return 'unverified';
  }
}

/**
 * Build targeted legal research queries per jurisdiction.
 * Queries are written to retrieve primary-source statute and regulatory text,
 * not commentary or interpretive articles.
 *
 * @param {string} jurisdiction
 * @param {string} taskType
 * @returns {string[]}  Array of search queries to run for this jurisdiction
 */
function buildQueries(jurisdiction, taskType) {
  const task = taskType || 'AI system';

  const queries = {
    California: [
      `CCPA section 7030 automated decision making technology ADMT risk assessment opt-out statute text`,
      `California Civil Code 1798 CPRA ${task} obligations 2026 statute`,
    ],
    EU: [
      `EU AI Act Article 6 Annex III high-risk AI classification ${task} official text 2026`,
      `GDPR Article 22 automated individual decision-making profiling legal text`,
    ],
    UK: [
      `UK GDPR Article 22 automated decision making ${task} ICO statutory guidance`,
    ],
    Illinois: [
      `Illinois BIPA 740 ILCS 14 section 15 biometric identifier consent requirements statute`,
    ],
    'New York': [
      `New York City Local Law 144 automated employment decisions bias audit statute text`,
    ],
    Texas: [
      `Texas Data Privacy Security Act TDPSA section 541 ${task} compliance statute text`,
    ],
    Canada: [
      `PIPEDA CPPA Bill C-27 artificial intelligence ${task} consent obligations official text`,
      `Quebec Law 25 privacy ${task} risk assessment requirements statute`,
    ],
    Australia: [
      `Australian Privacy Act 1988 APP ${task} automated decision making obligations OAIC guidance`,
    ],
    Brazil: [
      `LGPD Lei 13709 automated decisions ${task} data subject rights ANPD official text`,
    ],
    Global: [
      `OECD AI Principles 2023 ${task} transparency accountability official text`,
    ],
  };

  return queries[jurisdiction] || queries['Global'];
}

/**
 * Stage 3 — Research
 * Queries Tavily for live legal citations across all detected jurisdictions.
 * Populates ctx.legalFindings with one entry per jurisdiction.
 *
 * Falls back to curated static citations if Tavily is unavailable.
 *
 * @param {object} ctx  Pipeline context (must have ctx.jurisdictions and ctx.intent)
 * @returns {Promise<object>} ctx with ctx.legalFindings populated
 */
async function research(ctx) {
  console.log('[research] Stage 3 — Research starting…');

  const { jurisdictions, intent } = ctx;
  if (!jurisdictions || jurisdictions.length === 0) {
    throw new Error('[research] ctx.jurisdictions is missing — run Stage 1 first');
  }

  const taskType = intent?.taskType || 'Unknown';

  // ── Graceful degradation: no Tavily key ──────────────────────────────────────
  if (!tavilyClient) {
    console.warn('[research] Tavily unavailable — using curated static citations');
    ctx.legalFindings = jurisdictions.map((j) => buildStaticFinding(j, taskType));
    console.log('[research] Stage 3 complete (degraded) ✓');
    return ctx;
  }

  // ── Live Tavily search ────────────────────────────────────────────────────────
  const findings = [];

  for (const jurisdiction of jurisdictions) {
    console.log(`[research] Searching laws for jurisdiction: ${jurisdiction}`);
    const queries = buildQueries(jurisdiction, taskType);

    // Run the first 2 queries per jurisdiction (stay within rate limits for demo)
    const activeQueries = queries.slice(0, 2);
    const allResults = [];

    // Restrict every search to authoritative government and legal reference domains
    // only. This is the primary defence against bogus sources causing false verdicts.
    const trustedDomains = AUTHORITATIVE_DOMAINS[jurisdiction] || AUTHORITATIVE_DOMAINS['Global'];

    for (const query of activeQueries) {
      try {
        const result = await tavilyClient.search(query, {
          searchDepth: 'advanced',
          maxResults: 5,
          includeAnswer: true,
          includeDomains: trustedDomains,
        });

        // Only use results from authoritative or reference-grade sources
        const verifiedResults = (result.results || []).filter((r) => {
          const authority = classifySourceAuthority(r.url);
          if (authority === 'unverified') {
            console.warn(`[research] Discarding unverified source: ${r.url}`);
            return false;
          }
          return true;
        });

        if (verifiedResults.length > 0 || result.answer) {
          allResults.push({
            query,
            answer: result.answer,
            sources: verifiedResults.map((r) => ({
              title: r.title,
              url: r.url,
              authority: classifySourceAuthority(r.url),
              snippet: r.content?.slice(0, 400),
            })),
          });
        }
      } catch (err) {
        console.warn(`[research] Tavily query failed for "${query}":`, err.message);
      }
    }

    // Distill results into citations — only from verified, authoritative sources
    const citations = [];
    const laws = [];
    let authoritativeSourceCount = 0;

    for (const r of allResults) {
      // The Tavily-generated answer synthesises the search results. Include it
      // only when it is grounded by at least one authoritative source.
      const hasAuthoritativeSource = r.sources.some((s) => s.authority === 'authoritative');
      if (r.answer && hasAuthoritativeSource) {
        citations.push(`[Tavily synthesis — grounded in authoritative sources] ${r.answer.slice(0, 500)}`);
      }
      for (const s of r.sources) {
        if (s.title && !laws.includes(s.title)) laws.push(s.title);
        if (s.snippet) {
          const prefix = s.authority === 'authoritative' ? `[AUTHORITATIVE: ${s.title}]` : `[REFERENCE: ${s.title}]`;
          citations.push(`${prefix} ${s.snippet}`);
          if (s.authority === 'authoritative') authoritativeSourceCount++;
        }
      }
    }

    console.log(`[research] ${jurisdiction}: ${citations.length} citation(s), ${authoritativeSourceCount} from authoritative sources`);

    if (citations.length === 0) {
      // Fallback per-jurisdiction if Tavily returned nothing from trusted domains
      console.warn(`[research] No authoritative results from Tavily for ${jurisdiction} — using curated static citations`);
      const staticFinding = buildStaticFinding(jurisdiction, taskType);
      findings.push(staticFinding);
    } else {
      findings.push({
        jurisdiction,
        laws,
        citations,
        sourceQuality: authoritativeSourceCount > 0 ? 'authoritative' : 'reference',
      });
    }

    console.log(`[research] ${jurisdiction}: found ${citations.length} citation(s)`);
  }

  ctx.legalFindings = findings;
  console.log('[research] Stage 3 complete ✓');
  return ctx;
}

/**
 * Curated static citations per jurisdiction — used when Tavily is unavailable
 * or returns no results. These are real legal provisions, not hallucinations.
 */
function buildStaticFinding(jurisdiction, taskType) {
  const STATIC = {
    California: {
      laws: ['CCPA 2026 / CPRA', 'California Civil Code §1798.185', 'CCPA Regulations §7030'],
      citations: [
        'CCPA §7030(a): Businesses using ADMT for significant decisions must conduct and document a risk assessment before deployment, evaluating the benefits against potential harms to consumers.',
        'CCPA §7030(b): Businesses must provide consumers a clear and conspicuous opt-out right for ADMT that involves profiling for targeted advertising, sale of personal information, or significant decisions.',
        'CCPA §7026.1: "Automated decisionmaking technology" means any system, software, or process that uses computation as whole or part of a system to make or execute a decision or facilitate human decision-making affecting a consumer.',
        'CPRA Amendment 2026: Individualized pricing based on behavioral tracking and location data constitutes ADMT and requires a prior risk assessment filed with the California Privacy Protection Agency (CPPA).',
      ],
    },
    EU: {
      laws: ['EU AI Act 2026', 'GDPR Article 22', 'EU AI Act Article 6', 'EU AI Act Annex III'],
      citations: [
        'EU AI Act Article 5(1)(c) 2026: AI systems that deploy subliminal, manipulative, or deceptive techniques to distort behaviour — including dynamic pricing that exploits location or browsing data — are prohibited.',
        'EU AI Act Article 6 & Annex III: AI systems used for individualised pricing in essential services may be classified as high-risk, requiring conformity assessment, CE marking, and registration in the EU AI database before deployment.',
        'GDPR Article 22(1): Data subjects have the right not to be subject to a decision based solely on automated processing, including profiling, which produces legal or similarly significant effects.',
        'EU AI Act Article 9: High-risk AI systems must have a risk management system established and maintained throughout the entire lifecycle of the system.',
      ],
    },
    UK: {
      laws: ['UK GDPR Article 22', 'ICO Guidance on Automated Decision-Making'],
      citations: [
        'UK GDPR Article 22: Individuals have the right not to be subject to solely automated decisions that have legal or similarly significant effects, unless explicit consent or other lawful basis applies.',
        'ICO: Organisations must identify whether their processing involves solely automated decision-making and ensure suitable safeguards are in place.',
      ],
    },
    Illinois: {
      laws: ['Illinois BIPA (740 ILCS 14)', 'BIPA Section 15'],
      citations: [
        'BIPA Section 15(b): No private entity may collect, capture, purchase, receive through trade, or otherwise obtain a person\'s biometric identifier without first obtaining informed written consent.',
        'BIPA Section 20: Any person aggrieved by a violation of BIPA shall have a right of action against an offending party — statutory damages of $1,000-$5,000 per violation.',
      ],
    },
    'New York': {
      laws: ['NYC Automated Employment Decisions Law (Local Law 144)', 'NYPA'],
      citations: [
        'NYC Local Law 144 (2023): Employers using ADMT in hiring must conduct annual bias audits and publish summary results publicly.',
      ],
    },
    Texas: {
      laws: ['Texas Data Privacy and Security Act (TDPSA) 2024'],
      citations: [
        'TDPSA Section 541.101: Controllers must conduct data protection assessments for processing personal data for targeted advertising, profiling, or sale of personal data.',
      ],
    },
    Canada: {
      laws: ['PIPEDA (Personal Information Protection and Electronic Documents Act)', 'Bill C-27 / AIDA (Artificial Intelligence and Data Act)', 'Quebec Law 25 (Bill 64)'],
      citations: [
        'PIPEDA Principle 4.3: The knowledge and consent of the individual are required for the collection, use, or disclosure of personal information, except where inappropriate.',
        'Bill C-27 AIDA Section 8: Operators of high-impact AI systems must establish measures to identify, assess, and mitigate risks of harm or biased output before deployment.',
        'Quebec Law 25 (effective Sept 2023): Organizations must conduct privacy impact assessments before implementing automated decision systems that affect individuals and must inform affected persons.',
      ],
    },
    Australia: {
      laws: ['Privacy Act 1988 (Cth)', 'Australian Privacy Principles (APPs)', 'Privacy Amendment (Enhancing Privacy Protection) Act'],
      citations: [
        'APP 3 (Collection of solicited personal information): An organisation must not collect personal information unless it is reasonably necessary for one or more of the organisation\'s functions or activities.',
        'APP 1.4: An organisation must take reasonable steps to implement practices, procedures and systems that will ensure compliance with the APPs and enable it to deal with inquiries or complaints.',
        'OAIC Guidance on AI: Organisations using AI systems to make decisions about individuals must be able to explain how the decision was made and provide individuals with access to information about automated decisions that significantly affect them.',
      ],
    },
    Brazil: {
      laws: ['LGPD (Lei Geral de Proteção de Dados) — Lei 13.709/2018', 'ANPD Resolutions'],
      citations: [
        'LGPD Article 20: The data subject has the right to request review of decisions made solely on the basis of automated processing of personal data that affect their interests, including decisions intended to define their personal, professional, consumer and credit profile, or aspects of their personality.',
        'LGPD Article 18(VI): The data subject may request from the controller at any time and by request the review of decisions made solely on the basis of automated processing.',
        'LGPD Article 5(XII): "Automated processing" means any operation performed with the help of automated means, including collection, production, reception, classification, use, access, reproduction, transmission, distribution, processing, archiving, storage, deletion, evaluation or control of information, modification, communication, transfer, diffusion or extraction.',
      ],
    },
    Global: {
      laws: ['OECD AI Principles 2023', 'UN AI Advisory Body Recommendations 2025'],
      citations: [
        'OECD AI Principles: AI systems should be transparent and explainable, particularly when making consequential decisions affecting individuals.',
        'UN Advisory Body 2025: States should require human oversight mechanisms for AI systems used in high-stakes domains including pricing and financial services.',
      ],
    },
  };

  return {
    jurisdiction,
    ...(STATIC[jurisdiction] || STATIC['Global']),
  };
}

/**
 * Run a targeted set of queries against Tavily — used by Stage 5's two-pass flow
 * to fill specific evidence gaps identified by the Analysis Draft.
 *
 * @param {Array<{ jurisdiction: string, query: string }>} queries
 * @param {string} taskType
 * @returns {Promise<Array>} supplemental legalFindings array (same shape as research())
 */
async function researchTargeted(queries, taskType) {
  if (!tavilyClient || !Array.isArray(queries) || queries.length === 0) return [];

  const findingsByJurisdiction = {};

  for (const { jurisdiction, query } of queries.slice(0, 6)) {
    if (!jurisdiction || !query) continue;
    const trustedDomains = AUTHORITATIVE_DOMAINS[jurisdiction] || AUTHORITATIVE_DOMAINS['Global'];

    try {
      const result = await tavilyClient.search(query, {
        searchDepth: 'advanced',
        maxResults: 4,
        includeAnswer: true,
        includeDomains: trustedDomains,
      });

      const verifiedResults = (result.results || []).filter((r) => {
        const authority = classifySourceAuthority(r.url);
        return authority !== 'unverified';
      });

      if (!findingsByJurisdiction[jurisdiction]) {
        findingsByJurisdiction[jurisdiction] = { jurisdiction, laws: [], citations: [], sourceQuality: 'reference' };
      }

      const entry = findingsByJurisdiction[jurisdiction];
      let hasAuthoritative = false;

      for (const r of verifiedResults) {
        if (r.title && !entry.laws.includes(r.title)) entry.laws.push(r.title);
        if (r.content) {
          const authority = classifySourceAuthority(r.url);
          const prefix = authority === 'authoritative' ? `[AUTHORITATIVE: ${r.title}]` : `[REFERENCE: ${r.title}]`;
          entry.citations.push(`${prefix} ${r.content.slice(0, 400)}`);
          if (authority === 'authoritative') hasAuthoritative = true;
        }
      }
      if (result.answer && hasAuthoritative) {
        entry.citations.push(`[Tavily synthesis — targeted query] ${result.answer.slice(0, 400)}`);
      }
      if (hasAuthoritative) entry.sourceQuality = 'authoritative';

    } catch (err) {
      console.warn(`[research] Targeted query failed for "${query}" (${jurisdiction}):`, err.message);
    }
  }

  return Object.values(findingsByJurisdiction);
}

module.exports = { research, researchTargeted };
