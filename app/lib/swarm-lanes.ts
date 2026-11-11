/**
 * Distinct research assignments prevent multiple same-role workers from
 * merely restating each other's prompts. Lanes are hypotheses, not validated
 * competitive advantages. No provider calls are made by this registry.
 */
export const SWARM_LANES: Readonly<Record<string, readonly string[]>> = {
  seo:[
    "Search-intent gaps in nonbranded queries",
    "Internal-link graph and crawl-path bottlenecks",
    "Canonical, faceted navigation and duplicate-page risk",
    "Search Console cohort shifts and query-mix confounders",
    "Structured data, rich-result syntax and technical rendering",
    "Competitor coverage gaps and differentiated information value",
    "Product taxonomy, semantic clusters and entity relationships",
    "Counterfactual SEO test design and pretrends",
    "Image discovery and accessibility of product media",
    "International SEO and locale-specific landing pages",
  ],
  content:[
    "Audience unanswered questions and vocabulary",
    "Source provenance and fact-checking",
    "Customer-intent differentiators and original testing",
    "Editorial structure and topical information gain",
    "Product claim substantiation and regulatory boundaries",
    "Controlled content experiments and outcome measurement",
  ],
  manager:[
    "Merchant objectives and opportunity-cost allocation",
    "Cost and risk budget minimization",
    "Dependency planning across roles",
    "Experiment-priority and evidence thresholds",
  ],
  merch:[
    "Product discoverability and taxonomy",
    "Related-product graph and merchandising context",
    "Catalog duplicate/variant distinction",
    "Controlled product-page improvement proposals",
  ],
  analytics:[
    "Causal attribution and pretrend checks",
    "Traffic and cohort measurement integrity",
    "Conversion funnel instrumentation",
    "Incrementality and holdout design",
  ],
  retention:[
    "Consented retention cohort hypotheses",
    "Message fatigue and unsubscribe risk",
    "Lifecycle timing and customer-value measurement",
    "Controlled opt-in communication experiments",
  ],
  inventory:[
    "Availability uncertainty and missing data",
    "Sell-through seasonality",
    "Reorder lead-time sensitivity",
    "Stockout measurement and counterfactual",
  ],
  support:[
    "Recurring ticket taxonomy and root causes",
    "Knowledge-base evidence and verification",
    "Reply accuracy and privacy review",
    "Escalation handoff and customer impact",
  ],
  competitor:[
    "Primary-source public market changes",
    "Competitive claim fact-checking",
    "Untapped customer-intent questions",
    "Price-positioning context without scraping bypasses",
  ],
  amazon:[
    "Listing data integrity and merchant authorization",
    "Marketplace search query taxonomy",
    "Product detail policy and claim audit",
    "Controlled listing experiment design",
  ]
};

export const SKEPTIC_LANES = [
  "Counterfactual causal explanations and selection bias",
  "Independent source verification and contradiction hunting",
  "Commercial cost, adverse effects and experiment viability",
  "Permissions, privacy and operational failure modes",
  "Held-out replication, model leakage and result robustness",
] as const;

export function laneFor(role: string, index: number, kind: "specialist"|"skeptic") {
  if (!Number.isSafeInteger(index)||index<0||index>100000)throw new Error("Invalid lane assignment");
  const choices = kind==="skeptic" ? SKEPTIC_LANES : SWARM_LANES[role];
  if(!choices?.length)throw new Error("Unknown agent research role");
  const cycle=Math.floor(index/choices.length);
  return choices[index%choices.length]+(cycle? " (independent pass "+(cycle+1)+")":"");
}
