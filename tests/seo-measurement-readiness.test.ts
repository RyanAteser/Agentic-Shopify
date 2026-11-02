import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assessSeoMeasurementReadiness } from "../app/lib/seo-measurement-readiness";

const base = {
  catalogError: false,
  sampledProducts: 13,
  usableProductUrls: 0,
  hasCatalogCoverageWarning: true,
  primaryHost: null,
  connection: null,
};

const exact = {
  property: "https://artemisti.myshopify.com/",
  status: "active",
  lastSyncedAt: new Date("2026-11-01T00:00:00Z"),
};

test("all-null product URLs are never promoted to a clean SEO audit", () => {
  const result = assessSeoMeasurementReadiness(base);
  assert.equal(result.catalog, "no_public_urls");
  assert.equal(result.gsc, "not_connected");
  assert.equal(result.impact, "not_measured");
  assert.equal(result.readyToEvaluate, false);
});

test("catalog errors are distinguished from verified zero usable URLs", () => {
  const result = assessSeoMeasurementReadiness({...base, catalogError:true});
  assert.equal(result.catalog, "unavailable");
});

test("a successful bounded sample and an incomplete sample are distinguished", () => {
  assert.equal(assessSeoMeasurementReadiness({
    ...base,usableProductUrls:8,hasCatalogCoverageWarning:false
  }).catalog, "sampled");
  assert.equal(assessSeoMeasurementReadiness({
    ...base,usableProductUrls:8,hasCatalogCoverageWarning:true
  }).catalog, "partial_sample");
});

test("an inactive GSC connection is not a verified active property", () => {
  const state = assessSeoMeasurementReadiness({
    ...base,primaryHost:"artemisti.myshopify.com",
    connection:{...exact,status:"revoked"},
  });
  assert.equal(state.gsc,"inactive");
  assert.equal(state.readyToEvaluate,false);
});

test("active GSC connection requires verified Shopify primary domain", () => {
  const state = assessSeoMeasurementReadiness({...base,connection:exact});
  assert.equal(state.gsc,"host_unverified");
});

test("legacy, cross-store, protocol and subdomain properties fail closed", () => {
  for (const property of [
    "sc-domain:artemisti.myshopify.com",
    "https://monikablunderbeauty.com/",
    "http://artemisti.myshopify.com/",
    "https://another.artemisti.myshopify.com/",
    "https://artemisti.myshopify.com/products/",
  ]) {
    const result = assessSeoMeasurementReadiness({
      ...base,primaryHost:"artemisti.myshopify.com",
      connection:{...exact,property},
    });
    assert.equal(result.gsc,"property_mismatch",property);
    assert.equal(result.readyToEvaluate,false);
  }
});

test("exact active GSC scope does not imply experiment, product or page data", () => {
  const result = assessSeoMeasurementReadiness({
    ...base,primaryHost:"artemisti.myshopify.com",
    usableProductUrls:8,hasCatalogCoverageWarning:false,
    connection:exact,
  });
  assert.deepEqual(result,{
    catalog:"sampled",
    gsc:"verified_no_page_data",
    pageDailyEvidence:"not_collected",
    approvedIntervention:"not_recorded",
    impact:"not_measured",
    readyToEvaluate:false,
  });
});

test("malformed Shopify counts must not produce progress cards", () => {
  for(const data of [
    {...base,sampledProducts:-1},
    {...base,sampledProducts:1.5},
    {...base,sampledProducts:13,usableProductUrls:14},
    {...base,usableProductUrls:NaN},
  ]) assert.throws(()=>assessSeoMeasurementReadiness(data),/Invalid Shopify sample totals/);
});

test("SEO route is authenticated and scoped to current shop without experiment writes", () => {
  const route=readFileSync(new URL("../app/routes/app.seo.tsx",import.meta.url),"utf8");
  assert.match(route,/authenticate\.admin\(request\)/);
  assert.match(route,/where:\{shop\},select:\{property:true,status:true,lastSyncedAt:true\}/);
  assert.match(route,/primaryDomainForShop\(admin,shop\)/);
  assert.match(route,/heading="SEO measurement readiness"/);
  assert.match(route,/Impact status: Not measured/);
  assert.doesNotMatch(route,/monikablunderbeauty|UNAPPROVED_PUBLIC_RESEARCH/i);
  assert.doesNotMatch(route,/export const action\s*=/);
});
