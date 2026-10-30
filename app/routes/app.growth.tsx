import type {ActionFunctionArgs,HeadersFunction,LoaderFunctionArgs} from "react-router";
import {Form,Link,useActionData,useLoaderData,useNavigation} from "react-router";
import {boundary} from "@shopify/shopify-app-react-router/server";
import {authenticate} from "../shopify.server";
import db from "../db.server";
import {compareOrganicWindows,isExactHttpsStorefrontProperty} from "../lib/growth";
import {summarizeEditorialCohort,summarizeEditorialReviews} from "../lib/editorial-funnel";
import {loadDraftReviewCoverage} from "../lib/editorial-review-coverage.server";
import {disconnectGoogle,syncOrganicMetrics} from "../lib/gsc.server";

export const loader=async ({request}:LoaderFunctionArgs)=>{
  const {session}=await authenticate.admin(request);
  const shop=session.shop;
  const connection=await db.searchConsoleConnection.findUnique({
    where:{shop},select:{property:true,status:true,lastSyncedAt:true,connectedAt:true}
  });
  // Hide legacy domain-property data: it may include other subdomains and
  // protocols and must never appear as this merchant's storefront growth.
  const scoped=!!connection&&isExactHttpsStorefrontProperty(connection.property);
  const rows=scoped&&connection?await db.organicDailyMetric.findMany({
    where:{shop,property:connection.property},orderBy:{date:"desc"},take:90,
    select:{date:true,clicks:true,impressions:true,ctr:true,position:true}
  }):[];
  const chronological=rows.slice().reverse();
  const comparison=compareOrganicWindows(chronological);
  const now=new Date();
  const since=new Date(now.getTime()-28*86400000);
  // Only authenticated shop-scoped aggregates; no buyer/order data or new permissions.
  const [jobGroups,draftGroups,reviewGroups]=await Promise.all([
    db.contentJob.groupBy({
      by:["status"],where:{shop,createdAt:{gte:since,lt:now}},_count:{_all:true}
    }),
    db.articleDraft.groupBy({
      by:["status"],where:{shop,createdAt:{gte:since,lt:now}},_count:{_all:true}
    }),
    db.editorialReview.groupBy({
      by:["decision"],where:{shop,reviewedAt:{gte:since,lt:now}},
      _count:{_all:true,reviewMinutes:true},_sum:{reviewMinutes:true}
    })
  ]);
  const editorial=summarizeEditorialCohort(
    jobGroups.map(row=>({status:row.status,count:row._count._all})),
    draftGroups.map(row=>({status:row.status,count:row._count._all}))
  );
  const coverage=await loadDraftReviewCoverage(shop,since,now);
  const reviews=summarizeEditorialReviews(reviewGroups.map(row=>({
    decision:row.decision,count:row._count._all,
    minutesSamples:row._count.reviewMinutes,minutesTotal:row._sum.reviewMinutes??0
  })));
  return {shop,connection,scoped,comparison,editorial,reviews,coverage,recent:chronological.slice(-14),connected:new URL(request.url).searchParams.has("connected")};
};

export const action=async ({request}:ActionFunctionArgs)=>{
  const {session}=await authenticate.admin(request);
  const shop=session.shop;
  const form=await request.formData();
  const intent=String(form.get("intent")||"");
  if(intent==="disconnect"){
    // Destructive consent change requires explicit, authenticated merchant POST.
    await disconnectGoogle(shop);
    return {ok:true,message:"Search Console disconnected; stored metrics and token erased."};
  }
  if(intent==="sync"){
    const conn=await db.searchConsoleConnection.findUnique({where:{shop}});
    if(!conn||conn.status!=="active")return {ok:false,message:"Connect a Search Console property first."};
    if(!isExactHttpsStorefrontProperty(conn.property)){
      return {ok:false,message:"This legacy domain property includes other hosts. Disconnect and reconnect an exact HTTPS URL-prefix property."};
    }
    if(conn.lastSyncedAt&&Date.now()-conn.lastSyncedAt.getTime()<60*60000){
      return {ok:false,message:"Search Console was refreshed recently. Try again later."};
    }
    try{
      const result=await syncOrganicMetrics(shop);
      return {ok:true,message:"Imported "+result.rows+" date-level Google Search Console observations."};
    }catch(err){
      console.error("Growth data sync error",err instanceof Error?err.message:"unknown");
      return {ok:false,message:"Google synchronization failed. Confirm access and reconnect if needed."};
    }
  }
  return {ok:false,message:"Unsupported action."};
};
function number(x:number){return Math.round(x).toLocaleString();}
function pct(x:number|null){return x===null?"Insufficient baseline":(x>0?"+":"")+x.toFixed(1)+"%";}
export default function GrowthDashboard(){
  const {shop,connection,scoped,comparison,editorial,reviews,coverage,recent,connected}=useLoaderData<typeof loader>();
  const result=useActionData<typeof action>();
  const busy=useNavigation().state!=="idle";
  return <s-page heading="Growth · Verified Organic Search">
    <s-section heading="Measure what actually changes">
      <p><Link to="/app/manager">Store Manager</Link> · <Link to="/app/seo">SEO Intelligence</Link> · <Link to="/app">Blog Agent</Link></p>
      <p>Shop: {shop}. Google Search Console is the source of this dashboard. It is not an estimate from an AI model or Bright Data ranking snapshots.</p>
      <p>Growth measurement is descriptive: changes in search clicks do not prove which blog post or SEO change caused them.</p>
      {connected&&<p role="status">Google authorization completed. Import historical search performance below.</p>}
      {result&&<p role="status">{result.message}</p>}
    </s-section>
    <s-section heading="Editorial outcomes · rolling 28-day cohorts">
      <p>Generation requests created: <strong>{editorial.requests}</strong> ({editorial.failedJobs} failed; {editorial.uncertainJobs} awaiting dispatch reconciliation).</p>
      <p>Drafts created: <strong>{editorial.drafts}</strong>. Current status of those drafts: {editorial.published} published, {editorial.rejected} rejected, {editorial.awaitingReview} awaiting human review and {editorial.reconciliation} publishing or requiring reconciliation.</p>
      <p><strong>Published among resolved drafts:</strong> {editorial.publishedAmongResolvedPct===null?"Insufficient decisions":editorial.publishedAmongResolvedPct.toFixed(1)+"%"} ({editorial.published} published / {editorial.resolved} published or rejected). We display a percentage only after at least five decisions.</p>
      <p><strong>Resolved draft coverage:</strong> {editorial.resolvedCoveragePct===null?"Insufficient drafts":editorial.resolvedCoveragePct.toFixed(1)+"%"} ({editorial.resolved} resolved / {editorial.drafts} created). <strong>Published among all created drafts:</strong> {editorial.publishedAmongAllDraftsPct===null?"Insufficient drafts":editorial.publishedAmongAllDraftsPct.toFixed(1)+"%"} ({editorial.published} published / {editorial.drafts} created). Both percentages require at least five created drafts.</p>
      <p>The resolved-only rate can look favorable when most drafts remain pending. Coverage and the all-draft denominator expose that backlog; they are snapshot diagnostics, not merchant adoption, SEO results, sales conversion, or eventual publication probabilities.</p>
      <p>These are two separate creation-date cohorts, not a draft-delivery conversion funnel. Draft status is measured now, so publication may have happened after the creation window. Publishing is a proxy for editorial approval, not proof of factual quality, merchant revenue, SEO impact or user retention. Rejections and unresolved publication attempts deserve review.</p>
    </s-section>
    <s-section heading="Recorded human editorial reviews · rolling 28 days">
      <p><strong>{reviews.reviewed}</strong> explicit decisions: {reviews.usable} marked usable as written, {reviews.rejected} rejected.</p>
      <p><strong>Usable among recorded reviews:</strong> {reviews.usableAmongReviewedPct===null?"Insufficient reviews":reviews.usableAmongReviewedPct.toFixed(1)+"%"} (shown only after at least five decisions).</p>
      <p><strong>Self-reported review time:</strong> {reviews.meanReportedMinutes===null?"Not recorded":reviews.meanReportedMinutes.toFixed(1)+" minutes on average"} from {reviews.minutesSamples} reports. This is time spent, not time saved.</p>
      <p>These are voluntary, one-time decisions dated by review, not all drafts generated in the window. Unreviewed and directly published drafts are not counted as accepted or rejected; the observed share may be selection-biased. Marking usable never publishes an article. No revenue or productivity lift is implied.</p>
    </s-section>
    <s-section heading="Editorial review coverage · drafts created in the past 28 days">
      {!coverage.available ? <p role="status">Review participation is unavailable because the draft cohort exceeds the bounded reporting limit. No partial coverage percentage is shown.</p> : <>
        <p><strong>{coverage.reviewed}</strong> of <strong>{coverage.drafts}</strong> drafts created in this period have an explicit recorded editorial decision. <strong>{coverage.unreviewed}</strong> have no recorded decision.</p>
        <p><strong>Actionable editorial queue:</strong> {coverage.actionableUnreviewed} ready or needs-review draft(s) lack a recorded decision. {coverage.actionableAged7Days} are at least 7 days old; {coverage.actionableAged14Days} at least 14 days old. Oldest actionable draft: {coverage.oldestActionableDays===null?"None":coverage.oldestActionableDays+" days"}.</p>
        <p><strong>All missing-review records:</strong> {coverage.aged7Days} are at least 7 days old; {coverage.aged14Days} at least 14 days old. Oldest: {coverage.oldestUnreviewedDays===null?"None":coverage.oldestUnreviewedDays+" days"}. These also include published, rejected and reconciliation records, which are not actionable editorial decisions. Ages run from draft creation, not from entry into a review queue; neither metric proves abandonment.</p>
        <p><strong>Time to latest recorded review decision:</strong> {coverage.medianRecordedReviewHours===null?"Insufficient or inconsistent timestamps":coverage.medianRecordedReviewHours.toFixed(1)+" hours median"}; 90th percentile: {coverage.p90RecordedReviewHours===null?"Unavailable":coverage.p90RecordedReviewHours.toFixed(1)+" hours"} ({coverage.reviewElapsedSamples} valid recorded intervals; {coverage.reviewElapsedInvalid} invalid). These are elapsed clock hours from creation, not human labor or first-response time. Re-review after edits can increase them; pending drafts are excluded, so they are not a queue service-level guarantee.</p>
        <p><strong>Recorded review coverage:</strong> {coverage.coveragePct===null?"Insufficient drafts":coverage.coveragePct.toFixed(1)+"%"} (percentage shown after at least five created drafts). Recorded decisions: {coverage.usable} usable, {coverage.rejected} rejected.</p>
        {coverage.publishedWithoutReview>0&&<p role="status"><strong>{coverage.publishedWithoutReview}</strong> published draft(s) have no recorded editorial review. Investigate legacy or imported records; this is not evidence of a current publishing bypass.</p>}
        <p>This is a draft-creation cohort, unlike the review-date cohort above. Decisions may have occurred later, and an old usable review may now be stale after editing. Coverage measures recorded participation, not current approval, content accuracy, productivity gains or SEO results.</p>
      </>}
    </s-section>
    <s-section heading="Google Search Console connection">
      {!connection?<div>
        <p>No Google property connected. Actual SEO performance is currently unknown.</p>
        <a href="/app/growth/connect" target="_top" rel="noopener noreferrer">Connect Search Console (read-only Google consent)</a>
      </div>:<>
        <p><strong>Property:</strong> {connection.property} · <strong>Last sync:</strong> {connection.lastSyncedAt?new Date(connection.lastSyncedAt).toLocaleString():"Never"}</p>
        {!scoped&&<p role="alert">This legacy domain property includes other hosts or protocols. Its historical metrics are hidden and new imports are blocked. Disconnect, then connect a verified HTTPS URL-prefix property for the exact Shopify primary host. Disconnecting erases the old metrics and Google token.</p>}
        <div style={{display:"flex",gap:12}}>
          {scoped&&<Form method="post"><input type="hidden" name="intent" value="sync"/><button type="submit" disabled={busy}>Import latest measurements</button></Form>}
          <Form method="post" onSubmit={e=>{if(!window.confirm("Erase stored Google Search Console credentials and metrics for this store?"))e.preventDefault();}}>
            <input type="hidden" name="intent" value="disconnect"/><button type="submit" disabled={busy}>Disconnect and erase</button>
          </Form>
        </div>
      </>}
    </s-section>
    <s-section heading="Organic growth scorecard · Last 28 days versus previous 28 days">
      {!scoped&&connection?<p>Storefront-only growth measurements are unavailable until the legacy domain property is replaced. Historical cross-host metrics are intentionally hidden.</p>:!comparison.comparable?<p>Not enough comparable Search Console dates yet. We require all 28 observed dates in each window; Google can omit no-traffic dates, which are not assumed to be zero. No growth claim can be made.</p>:<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:16}}>
          <div><strong>Organic clicks</strong><p style={{fontSize:24}}>{number(comparison.current.clicks)}</p><p>Previous: {number(comparison.previous.clicks)} · {pct(comparison.clicksChangePct)}</p></div>
          <div><strong>Search impressions</strong><p style={{fontSize:24}}>{number(comparison.current.impressions)}</p><p>Previous: {number(comparison.previous.impressions)} · {pct(comparison.impressionsChangePct)}</p></div>
          <div><strong>Click-through rate</strong><p style={{fontSize:24}}>{(comparison.current.ctr*100).toFixed(2)}%</p><p>Observed clicks ÷ impressions</p></div>
          <div><strong>Average position</strong><p style={{fontSize:24}}>{comparison.current.avgPosition?.toFixed(1)??"—"}</p><p>Impression-weighted across available dates</p></div>
        </div>
      </>}
      <p>Observed coverage: {comparison.current.days}/28 current dates and {comparison.previous.days}/28 baseline dates.</p>
      <p>Both windows use Google Search Console's Pacific reporting dates and exclude the three most recent calendar days. Finalized Google data can still be delayed; coverage and seasonality affect interpretation.</p>
    </s-section>
    <s-section heading="Recent recorded days">
      {!recent.length?<p>No authenticated Search Console observations yet.</p>:
      <table style={{width:"100%",textAlign:"left"}}>
        <thead><tr><th>Date</th><th>Clicks</th><th>Impressions</th><th>CTR</th><th>Position</th></tr></thead>
        <tbody>{recent.map(r=><tr key={r.date}><td>{r.date}</td><td>{number(r.clicks)}</td><td>{number(r.impressions)}</td><td>{(r.ctr*100).toFixed(1)}%</td><td>{r.position.toFixed(1)}</td></tr>)}</tbody>
      </table>}
      <p><strong>Conversions and revenue:</strong> Not connected. We will not report ROI until Shopify order attribution or approved analytics data can support it.</p>
    </s-section>
  </s-page>;
}
export const headers:HeadersFunction=args=>boundary.headers(args);
