import type { LoaderFunctionArgs, HeadersFunction } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { auditProductSeo, type SeoProduct } from "../lib/seo";
import { readShopifySeoCatalog, summarizeShopifySeoSample } from "../lib/shopify-product-sample";
import { sameRankTarget } from "../lib/manager";
import { primaryDomainForShop } from "../lib/ranking-ingest.server";
import { assessSeoMeasurementReadiness } from "../lib/seo-measurement-readiness";

export const loader=async ({request}:LoaderFunctionArgs) => {
  const {admin,session}=await authenticate.admin(request);
  const shop=session.shop;
  const observations=await db.seoRankObservation.findMany({
    where:{shop},orderBy:{observedAt:"desc"},take:500,
    select:{keyword:true,engine:true,country:true,device:true,position:true,observedAt:true,targetUrl:true},
  });
  let products:SeoProduct[]=[];
  let catalogError="";
  let sampleCount=0;
  let coverageWarning="";
  try {
    const catalog=await readShopifySeoCatalog(admin);
    const coverage=summarizeShopifySeoSample(catalog.products, catalog.hasMore);
    products=coverage.eligibleProducts;
    sampleCount=coverage.sampledProducts;
    coverageWarning=coverage.warning;
  }catch(error){
    catalogError=error instanceof Error?error.message:"Could not inspect catalog";
  }
  const allFindings=auditProductSeo(products);
  const findings=allFindings.slice(0,60);
  const seen=new Map<string,{keyword:string;engine:string;country:string;device:string;position:number|null;targetUrl:string;observedAt:Date;previous:number|null;count:number}>();
  for(const o of observations){
    const key=[o.keyword,o.engine,o.country,o.device].join("|");
    const existing=seen.get(key);
    if(!existing) {
      seen.set(key,{keyword:o.keyword,engine:o.engine,country:o.country,device:o.device,
        position:o.position,targetUrl:o.targetUrl,observedAt:o.observedAt,previous:null,count:1});
    } else if(existing.count===1 && o.observedAt.getTime()!==existing.observedAt.getTime()){
      existing.previous=sameRankTarget(existing.targetUrl,o.targetUrl)?o.position:null;
      existing.count=2;
    }
  }
  const rankingRows=Array.from(seen.values()).slice(0,40);
  // This page may inspect only its authenticated Shopify merchant's GSC state.
  // Do not merge public competitor research or offer a mutation from this view.
  const connection=await db.searchConsoleConnection.findUnique({
    where:{shop},select:{property:true,status:true,lastSyncedAt:true}
  });
  let primaryHost:string|null=null;
  if(connection?.status==="active"){
    try {
      primaryHost=await primaryDomainForShop(admin,shop);
    }catch {
      // Domain attestation is a hard prerequisite for claiming exact GSC scope.
      // The catalog and ranking audit should still render on Shopify API errors.
    }
  }
  const measurement=assessSeoMeasurementReadiness({
    catalogError:!!catalogError,sampledProducts:sampleCount,
    usableProductUrls:products.length,hasCatalogCoverageWarning:!!coverageWarning,
    primaryHost,connection,
  });
  return {shop,productCount:products.length,sampleCount,coverageWarning,findings,findingCount:allFindings.length,catalogError,rankingRows,rankingCount:observations.length,measurement,connectionProperty:connection?.property??null};
};

export default function SeoDashboard(){
  const {shop,productCount,sampleCount,coverageWarning,findings,findingCount,catalogError,rankingRows,rankingCount,measurement,connectionProperty}=useLoaderData<typeof loader>();
  return <s-page heading="Agentic Shopify · SEO Intelligence">
    <s-section heading="SEO agents">
      <p>This dashboard connects product-page checks with your Bright Data ranking workflow. All detected issues are recommendations; nothing on this page edits your store.</p>
      <p>Connected store: <strong>{shop}</strong> · <Link to="/app">Blog Agent</Link> · <Link to="/app/manager">Manager Inbox</Link> · <Link to="/app/growth">Verified Growth</Link></p>
    </s-section>
    <s-section heading="Product metadata audit">
      <p>Shopify returned <strong>{sampleCount}</strong> active Online Store-published products (up to 100 queried across two bounded pages); <strong>{productCount}</strong> had usable HTTPS storefront URLs and were evaluated. Unlisted and other-channel-only inventory is excluded. This is not a complete crawl, proof of indexing or a Google ranking score.</p>
      {!catalogError && coverageWarning && <p role="status">{coverageWarning}</p>}
      {catalogError && <p role="alert">Catalog unavailable: {catalogError}. Recheck read_products permission.</p>}
      {!catalogError && productCount===0 && <p>No product pages with usable storefront URLs were evaluated. This does not establish that the store has no published products or no metadata issues.</p>}
      {!catalogError && productCount>0 && !findings.length && <p>No obvious metadata issues detected in the sampled products.</p>}
      {findingCount>findings.length && <p role="status">Showing the first {findings.length} of {findingCount} sampled metadata findings. More findings exist; this is a bounded review queue, not a complete issue list.</p>}
      {Boolean(findings.length) && <div style={{overflowX:"auto"}}>
        <table style={{borderCollapse:"collapse",width:"100%"}}>
          <thead><tr><th style={{textAlign:"left"}}>Product</th><th style={{textAlign:"left"}}>Priority</th><th style={{textAlign:"left"}}>Recommendation</th></tr></thead>
          <tbody>{findings.map(item=><tr key={item.id}>
            <td style={{padding:"8px 12px 8px 0"}}>{item.url?<a href={item.url} target="_blank" rel="noopener noreferrer">{item.productTitle}</a>:item.productTitle}</td>
            <td>{item.severity}</td><td>{item.message}</td>
          </tr>)}</tbody>
        </table>
      </div>}
    </s-section>
    <s-section heading="SEO measurement readiness">
      <p><strong>Impact status: Not measured.</strong> Product metadata checks and isolated ranking observations cannot establish an increase in search traffic, clicks, or revenue. No controlled metadata experiment is recorded in this workspace.</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(210px, 1fr))",gap:12}}>
        <div style={{padding:14,border:"1px solid #e2e8e4",borderRadius:10}}>
          <strong>1. Public product URLs</strong>
          {measurement.catalog==="unavailable"?
            <p role="status">Catalog request failed. Storefront coverage is unknown.</p>:
            measurement.catalog==="no_public_urls"?
            <p role="status">No usable HTTPS product URLs in the current Shopify sample ({sampleCount} records). An empty audit is not proof of good SEO.</p>:
            <p>{productCount} usable URL(s) in a {sampleCount}-product sample. {measurement.catalog==="partial_sample"?"Coverage is incomplete.":"This is a sample, not a crawl."}</p>}
        </div>
        <div style={{padding:14,border:"1px solid #e2e8e4",borderRadius:10}}>
          <strong>2. Store-specific Search Console</strong>
          {measurement.gsc==="not_connected"?
            <p>Not connected. <Link to="/app/growth">Open the read-only Google consent workflow</Link>.</p>:
            measurement.gsc==="inactive"?
            <p role="status">The recorded Search Console connection is inactive. Reconnect from <Link to="/app/growth">Verified Growth</Link>.</p>:
            measurement.gsc==="host_unverified"?
            <p role="status">Shopify primary-domain attestation is unavailable. GSC scope cannot be confirmed.</p>:
            measurement.gsc==="property_mismatch"?
            <p role="status">The saved Google property does not match this Shopify store's current primary HTTPS host. Reconnect a matching URL-prefix property.</p>:
            <p>The recorded Google property matches the current Shopify primary host: <strong>{connectionProperty}</strong>. This does not supply page-level experiment data.</p>}
        </div>
        <div style={{padding:14,border:"1px solid #e2e8e4",borderRadius:10}}>
          <strong>3. Page/day performance evidence</strong>
          <p>Not collected. The current <Link to="/app/growth">Growth</Link> importer stores property-level daily totals, not individual product-page experiment cohorts. Do not infer per-product lift from site totals.</p>
        </div>
        <div style={{padding:14,border:"1px solid #e2e8e4",borderRadius:10}}>
          <strong>4. Approved controlled change</strong>
          <p>Not recorded. No merchant-approved treatment, unchanged comparison pages, intervention date, or finalized follow-up window is documented for this store.</p>
        </div>
      </div>
      <p><strong>Next safe step:</strong> Verify this store's public product URLs and, if desired, connect its own read-only Search Console property. A future page-level experiment requires separate merchant approval and explicit evidence collection. This page cannot import public research from another store or publish content.</p>
    </s-section>
    <s-section heading="Keyword rankings · Bright Data SERP">
      <p>Recorded observations: {rankingCount}. Results are tied to keyword, country, search engine and device. Previous rank and change are shown only when consecutive snapshots refer to the same HTTPS result URL; a change of ranking page is not treated as a page-level ranking loss. A SERP observation is not equivalent to Search Console average position. Store Manager requires three consecutive same-page observations before recommending investigation of a repeated rank decline; this is a heuristic, not proof of lost traffic.</p>
      {!rankingRows.length && <p>No ranking observations imported yet. Your existing n8n Bright Data workflow can POST verified observations to the private ingestion endpoint described in docs/SEO-AGENTS.md.</p>}
      {Boolean(rankingRows.length) && <div style={{overflowX:"auto"}}>
        <table style={{borderCollapse:"collapse",width:"100%"}}>
          <thead><tr><th>Keyword</th><th>Market</th><th>Latest rank</th><th>Previous</th><th>Change</th><th>Observed</th></tr></thead>
          <tbody>{rankingRows.map(r=>{
            const delta=r.previous!==null&&r.position!==null?r.previous-r.position:null;
            return <tr key={[r.keyword,r.engine,r.country,r.device].join("|")}>
              <td style={{padding:"8px"}}>{r.keyword}</td>
              <td>{r.engine} · {r.country} · {r.device}</td>
              <td>{r.position??"Not found"}</td><td>{r.previous??"—"}</td>
              <td>{delta===null?"—":delta>0?"↑ "+delta:delta<0?"↓ "+Math.abs(delta):"Unchanged"}</td>
              <td>{new Date(r.observedAt).toLocaleDateString()}</td>
            </tr>;
          })}</tbody>
        </table>
      </div>}
    </s-section>
    <s-section heading="Next integrations">
      <p>Verified Growth currently tracks Google Search Console property-level daily totals. Page/day comparisons, signed merchant approval records and controlled metadata experiments are not yet collected. Do not describe metadata suggestions as traffic or revenue gains. Amazon Listing SEO will be a separate opt-in connector requiring Selling Partner API approval.</p>
    </s-section>
  </s-page>;
}
export const headers:HeadersFunction=args=>boundary.headers(args);
