// Non-secret product capability registry. Status represents implementation, not live availability.
export type AgentStatus = "prototype" | "in_development" | "planned";
export type AgentRisk = "observe" | "draft" | "approval_required" | "blocked";
export type AgentDefinition = {
  id: string; name: string; domain: string; purpose: string;
  status: AgentStatus; permitted: AgentRisk[];
  requires: string[]; nextMilestone: string;
};
export const AGENTS: readonly AgentDefinition[] = [
  { id:"manager",name:"AI Store Manager",domain:"Operations",purpose:"Prioritize recommendations, monitor costs and coordinate specialized workers.",status:"planned",permitted:["observe","draft"],requires:["Job ledger","Budget guardrails"],nextMilestone:"Unified task and approval inbox" },
  { id:"seo",name:"SEO Auditor",domain:"Discovery",purpose:"Audit catalog metadata, track keyword observations and propose SEO fixes.",status:"in_development",permitted:["observe","draft"],requires:["read_products","Merchant-authorized SERP/GSC"],nextMilestone:"Merchant SEO dashboard + rank adapter" },
  { id:"content",name:"Blog & Content Editor",domain:"Content",purpose:"Generate product-grounded articles, route through editorial quality checks.",status:"prototype",permitted:["observe","draft","approval_required"],requires:["write_content","read_products","n8n AI credentials"],nextMilestone:"Shopify dev-store E2E publishing verification" },
  { id:"merch",name:"Merchandising Specialist",domain:"Catalog",purpose:"Draft product and collection improvements.",status:"planned",permitted:["observe","draft"],requires:["read_products","write_products after approval"],nextMilestone:"Proposed-diff review queue" },
  { id:"analytics",name:"Growth Analyst",domain:"Analytics",purpose:"Interpret storefront traffic and order outcomes from verified sources.",status:"planned",permitted:["observe","draft"],requires:["Merchant-opt-in analytics"],nextMilestone:"Search Console/GA4 attribution data model" },
  { id:"retention",name:"Lifecycle Marketer",domain:"Marketing",purpose:"Draft targeted campaign ideas for merchant review.",status:"planned",permitted:["observe","draft"],requires:["Opt-in ESP connection","Marketing consent"],nextMilestone:"Reviewable email drafts" },
  { id:"inventory",name:"Inventory Planner",domain:"Operations",purpose:"Forecast sell-through and flag potential stockouts.",status:"planned",permitted:["observe","draft"],requires:["Authorized inventory/order aggregates"],nextMilestone:"Read-only low-stock insights" },
  { id:"support",name:"Customer Support Assistant",domain:"Support",purpose:"Summarize incoming tickets and prepare suggested responses.",status:"planned",permitted:["observe","draft"],requires:["Opt-in ticketing connection","Privacy review"],nextMilestone:"Draft-only ticket triage" },
  { id:"competitor",name:"Market Intelligence Researcher",domain:"Research",purpose:"Monitor lawful public competitor signals and topic coverage.",status:"planned",permitted:["observe","draft"],requires:["Public web sources","Budgeted search provider"],nextMilestone:"Evidence and provenance store" },
  { id:"amazon",name:"Amazon Marketplace Specialist",domain:"Marketplace",purpose:"Audit merchant-authorized Amazon listings and draft optimizations.",status:"planned",permitted:["observe","draft"],requires:["Amazon SP-API authorization"],nextMilestone:"Read-only Seller Central connector" },
];
export const STATUS_LABELS: Record<AgentStatus,string> = {
  prototype:"Code prototype", in_development:"In development", planned:"Planned"
};
