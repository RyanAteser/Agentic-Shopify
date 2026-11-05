/** Privacy-safe, low-cardinality catalog-read events. Never include shop IDs, tokens, URLs or errors. */
export type CatalogReadStage = "primary_domain" | "catalog_page" | "audit";
export type CatalogReadOutcome = "success" | "failure";

export function catalogReadEvent(outcome: CatalogReadOutcome, stage: CatalogReadStage) {
  return JSON.stringify({
    event: "catalog_read",
    outcome,
    stage,
    version: 1,
  });
}
