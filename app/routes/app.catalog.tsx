import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { auditProductSeo } from "../lib/seo";
import { readShopifySeoCatalog, summarizeShopifySeoSample } from "../lib/shopify-product-sample";
import { readOnlyPilotEnabled } from "../lib/pilot-readonly";
import { primaryDomainForShop } from "../lib/ranking-ingest.server";
import { scopePilotCatalog } from "../lib/pilot-catalog-scope";

/** Catalog-only proof of authenticated Shopify access; no persistence or writes. */
export const loader = async ({ request }: LoaderFunctionArgs) => {
  if (!readOnlyPilotEnabled()) {
    throw new Response("Catalog pilot not enabled", { status: 404 });
  }
  const { admin, session } = await authenticate.admin(request);
  try {
    const primaryHost = await primaryDomainForShop(admin, session.shop);
    const catalog = await readShopifySeoCatalog(admin);
    const coverage = summarizeShopifySeoSample(catalog.products, catalog.hasMore);
    const scoped = scopePilotCatalog(coverage.eligibleProducts, primaryHost);
    const findings = auditProductSeo(scoped.eligible);
    return {
      shop: session.shop,
      unavailable: false,
      sampled: coverage.sampledProducts,
      eligible: scoped.eligible.length,
      warning: [coverage.warning,
        scoped.excludedForeign ? `${scoped.excludedForeign} product URL(s) were on a different host from the Shopify-attested primary storefront and were excluded.` : "",
        scoped.eligible.length < coverage.eligibleProducts.length ? "The eligible primary-domain sample is partial; excluded pages were not audited." : ""
      ].filter(Boolean).join(" "),
      findings: findings.slice(0, 25).map((finding) => ({
        id: finding.id,
        productTitle: finding.productTitle,
        kind: finding.kind,
        message: finding.message,
        severity: finding.severity,
      })),
      findingCount: findings.length,
    };
  } catch (error) {
    // Do not leak Shopify tokens, GraphQL response bodies, or data from
    // another tenant to the browser or application logs.
    console.warn("Read-only catalog pilot unavailable", error instanceof Error ? error.name : "unknown");
    return { shop: session.shop, unavailable: true, sampled: 0, eligible: 0,
      warning: "Shopify catalog could not be verified. No audit conclusions are available.",
      findings: [], findingCount: 0 };
  }
};

export default function CatalogPilot() {
  const data = useLoaderData<typeof loader>();
  return <s-page heading="Catalog intelligence · read-only pilot">
    <s-section heading="Connection">
      <p>Authenticated Shopify merchant: <strong>{data.shop}</strong>.</p>
      <p>Only product-catalog reads are enabled. No content, product, price, inventory,
         or customer data will be changed by this view.</p>
      {data.unavailable
        ? <p role="alert">{data.warning}</p>
        : <>
          <p>Sampled products: {data.sampled}. Eligible product URLs: {data.eligible}.
             Review observations: {data.findingCount}.</p>
          <p>{data.warning || "This is a bounded sample, not proof of Google indexing or SEO growth."}</p>
          {data.findings.map((finding) => <div key={finding.id}>
            <p><strong>{finding.productTitle}</strong> · {finding.severity} · {finding.kind}</p>
            <p>{finding.message}</p>
          </div>)}
          {!data.findings.length && <p>No issues detected in the eligible sample.
            This does not establish that the full catalog is free of issues.</p>}
        </>}
    </s-section>
  </s-page>;
}

export function ErrorBoundary() {
  return boundary.error(useRouteError());
}
export const headers: HeadersFunction = (args) => boundary.headers(args);
