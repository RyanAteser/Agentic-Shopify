import type {ActionFunctionArgs,HeadersFunction,LoaderFunctionArgs} from "react-router";
import {Form,Link,useActionData,useLoaderData,useNavigation} from "react-router";
import {boundary} from "@shopify/shopify-app-react-router/server";
import {authenticate} from "../shopify.server";
import db from "../db.server";
import {compareOrganicWindows} from "../lib/growth";
import {disconnectGoogle,syncOrganicMetrics} from "../lib/gsc.server";

export const loader=async ({request}:LoaderFunctionArgs)=>{
  const {session}=await authenticate.admin(request);
  const shop=session.shop;
  const connection=await db.searchConsoleConnection.findUnique({
    where:{shop},select:{property:true,status:true,lastSyncedAt:true,connectedAt:true}
  });
  const rows=connection?await db.organicDailyMetric.findMany({
    where:{shop,property:connection.property},orderBy:{date:"asc"},take:90,
    select:{date:true,clicks:true,impressions:true,ctr:true,position:true}
  }):[];
  const comparison=compareOrganicWindows(rows);
  return {shop,connection,comparison,recent:rows.slice(-14),connected:new URL(request.url).searchParams.has("connected")};
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
  const {shop,connection,comparison,recent,connected}=useLoaderData<typeof loader>();
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
    <s-section heading="Google Search Console connection">
      {!connection?<div>
        <p>No Google property connected. Actual SEO performance is currently unknown.</p>
        <a href="/app/growth/connect" target="_top" rel="noopener noreferrer">Connect Search Console (read-only Google consent)</a>
      </div>:<>
        <p><strong>Property:</strong> {connection.property} · <strong>Last sync:</strong> {connection.lastSyncedAt?new Date(connection.lastSyncedAt).toLocaleString():"Never"}</p>
        <div style={{display:"flex",gap:12}}>
          <Form method="post"><input type="hidden" name="intent" value="sync"/><button type="submit" disabled={busy}>Import latest measurements</button></Form>
          <Form method="post" onSubmit={e=>{if(!window.confirm("Erase stored Google Search Console credentials and metrics for this store?"))e.preventDefault();}}>
            <input type="hidden" name="intent" value="disconnect"/><button type="submit" disabled={busy}>Disconnect and erase</button>
          </Form>
        </div>
      </>}
    </s-section>
    <s-section heading="Organic growth scorecard · Last 28 days versus previous 28 days">
      {!comparison.comparable?<p>Not enough verified daily measurements yet. We need at least 21 recorded days in each comparison window. No growth claim can be made.</p>:<>
        <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(150px,1fr))",gap:16}}>
          <div><strong>Organic clicks</strong><p style={{fontSize:24}}>{number(comparison.current.clicks)}</p><p>Previous: {number(comparison.previous.clicks)} · {pct(comparison.clicksChangePct)}</p></div>
          <div><strong>Search impressions</strong><p style={{fontSize:24}}>{number(comparison.current.impressions)}</p><p>Previous: {number(comparison.previous.impressions)} · {pct(comparison.impressionsChangePct)}</p></div>
          <div><strong>Click-through rate</strong><p style={{fontSize:24}}>{(comparison.current.ctr*100).toFixed(2)}%</p><p>Observed clicks ÷ impressions</p></div>
          <div><strong>Average position</strong><p style={{fontSize:24}}>{comparison.current.avgPosition?.toFixed(1)??"—"}</p><p>Impression-weighted across available dates</p></div>
        </div>
      </>}
      <p>These windows exclude the three most recent UTC days because Google reporting can be delayed. Incomplete coverage and seasonality can affect comparisons.</p>
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
