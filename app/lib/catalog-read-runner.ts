import { catalogReadEvent, type CatalogReadStage } from "./catalog-read-observability";

/** Telemetry must never determine whether a read-only audit succeeds or fails. */
function emitBestEffort(
  emit: (level: "info" | "warn", event: string) => void,
  level: "info" | "warn",
  event: string,
): void {
  try {
    emit(level, event);
  } catch {
    // A failed log transport must not expose provider errors or hide an audit result.
  }
}

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
  let value: Audit;
  try {
    const domain = await operations.primaryDomain();
    stage = "catalog_page";
    const catalog = await operations.catalogPage();
    stage = "audit";
    value = operations.audit(domain, catalog);
  } catch {
    emitBestEffort(emit, "warn", catalogReadEvent("failure", stage));
    return { ok: false };
  }
  emitBestEffort(emit, "info", catalogReadEvent("success", stage));
  return { ok: true, value };
}
