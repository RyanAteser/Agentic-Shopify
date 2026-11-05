import { catalogReadEvent, type CatalogReadStage } from "./catalog-read-observability";

/** Testable read-only orchestration; never logs provider exceptions or tenant data. */
export async function runObservedCatalogRead<Domain, Catalog, Audit>(
  operations: {
    primaryDomain: () => Promise<Domain>;
    catalogPage: () => Promise<Catalog>;
    audit: (domain: Domain, catalog: Catalog) => Audit;
  },
  emit: (level: "info" | "warn", event: string) => void,
): Promise<{ ok: true; value: Audit } | { ok: false }> {
  let stage: CatalogReadStage = "primary_domain";
  try {
    const domain = await operations.primaryDomain();
    stage = "catalog_page";
    const catalog = await operations.catalogPage();
    stage = "audit";
    const value = operations.audit(domain, catalog);
    emit("info", catalogReadEvent("success", stage));
    return { ok: true, value };
  } catch {
    emit("warn", catalogReadEvent("failure", stage));
    return { ok: false };
  }
}
