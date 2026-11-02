import { matchesPrimaryDomain } from "./growth";

/**
 * Merchant-scoped, READ-ONLY SEO experiment status.
 *
 * Product URLs and GSC property credentials must belong to the authenticated
 * Shopify merchant. Public audits of a different store never enter this model.
 * The existing GSC importer has property/date totals, NOT product/page/day
 * observations. Never infer that an experiment was conducted from a connection.
 */
export type SeoMeasurementInput = {
  catalogError: boolean;
  sampledProducts: number;
  usableProductUrls: number;
  hasCatalogCoverageWarning: boolean;
  primaryHost: string | null;
  connection: { property: string; status: string; lastSyncedAt: Date | null } | null;
};

export type SeoMeasurementStatus = {
  catalog: "unavailable" | "no_public_urls" | "sampled" | "partial_sample";
  gsc: "not_connected" | "inactive" | "host_unverified" | "property_mismatch" | "verified_no_page_data";
  pageDailyEvidence: "not_collected";
  approvedIntervention: "not_recorded";
  impact: "not_measured";
  readyToEvaluate: false;
};

export function assessSeoMeasurementReadiness(input: SeoMeasurementInput): SeoMeasurementStatus {
  if (!Number.isSafeInteger(input.sampledProducts) || input.sampledProducts < 0 ||
      !Number.isSafeInteger(input.usableProductUrls) || input.usableProductUrls < 0 ||
      input.usableProductUrls > input.sampledProducts) {
    throw new Error("Invalid Shopify sample totals");
  }
  const catalog = input.catalogError ? "unavailable" :
    input.usableProductUrls === 0 ? "no_public_urls" :
    input.hasCatalogCoverageWarning ? "partial_sample" : "sampled";

  const gsc = !input.connection ? "not_connected" :
    input.connection.status !== "active" ? "inactive" :
    !input.primaryHost ? "host_unverified" :
    !matchesPrimaryDomain(input.connection.property, input.primaryHost) ?
      "property_mismatch" : "verified_no_page_data";
  return {
    catalog,
    gsc,
    pageDailyEvidence: "not_collected",
    approvedIntervention: "not_recorded",
    impact: "not_measured",
    readyToEvaluate: false,
  };
}
