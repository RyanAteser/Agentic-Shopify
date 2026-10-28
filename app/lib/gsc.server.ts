import db from "../db.server";
import {decryptToken,encryptToken} from "./gsc-crypto.server";
import {assertPropertyAggregation,gscReportingWindow,isExactHttpsStorefrontProperty,matchesPrimaryDomain,parseSearchConsoleRows} from "./growth";

const SCOPE="https://www.googleapis.com/auth/webmasters.readonly";
const GOOGLE_AUTHORIZE="https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN="https://oauth2.googleapis.com/token";
const GSC_BASE="https://www.googleapis.com/webmasters/v3";

function secrets(){
  const clientId=process.env.GSC_CLIENT_ID,clientSecret=process.env.GSC_CLIENT_SECRET;
  const appUrl=process.env.SHOPIFY_APP_URL;
  if(!clientId||!clientSecret||!appUrl)throw new Error("Search Console OAuth is not configured");
  const origin=new URL(appUrl);
  if(origin.protocol!=="https:" && origin.hostname!=="localhost")throw new Error("HTTPS required for Google OAuth");
  return {clientId,clientSecret,callback:origin.origin+"/auth/google/callback"};
}
export function googleAuthorizationUrl(state:string){
  const {clientId,callback}=secrets();
  const url=new URL(GOOGLE_AUTHORIZE);
  url.searchParams.set("response_type","code");
  url.searchParams.set("client_id",clientId);
  url.searchParams.set("redirect_uri",callback);
  url.searchParams.set("scope",SCOPE);
  url.searchParams.set("access_type","offline");
  url.searchParams.set("prompt","consent");
  url.searchParams.set("state",state);
  return url.toString();
}
async function googleFetch(url:string,options:RequestInit) {
  const result=await fetch(url,{...options,signal:AbortSignal.timeout(15000)});
  if(!result.ok)throw new Error("Google API request failed (HTTP "+result.status+")");
  return result.json();
}
export async function googleExchangeCode(code:string){
  const {clientId,clientSecret,callback}=secrets();
  const value=await googleFetch(GOOGLE_TOKEN,{
    method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({code,client_id:clientId,client_secret:clientSecret,
      redirect_uri:callback,grant_type:"authorization_code"}),
  });
  if(!value.access_token||!value.refresh_token)throw new Error("Google did not issue offline tokens");
  return {accessToken:String(value.access_token),refreshToken:String(value.refresh_token)};
}
export async function verifyGoogleSite(accessToken:string,primaryHost:string) {
  const result=await googleFetch(GSC_BASE+"/sites",{headers:{Authorization:"Bearer "+accessToken}});
  const options=(Array.isArray(result.siteEntry)?result.siteEntry:[])
    // Fail closed: unknown/missing permission values are not evidence of
    // verified access. Google documents exactly three verified access levels.
    .filter((x:any)=>["siteOwner","siteFullUser","siteRestrictedUser"].includes(x?.permissionLevel)&&
      typeof x.siteUrl==="string"&&matchesPrimaryDomain(x.siteUrl,primaryHost));
  if(!options.length)throw new Error("Add a verified HTTPS URL-prefix Search Console property for your exact Shopify primary host. Domain properties include other hosts and cannot support this storefront-only scorecard.");
  return String(options[0].siteUrl);
}
export async function storeGoogleConnection(shop:string,property:string,refreshToken:string,stateHash:string) {
  if(!isExactHttpsStorefrontProperty(property))throw new Error("Storefront-only metrics require an exact HTTPS URL-prefix property");
  const encryptedRefresh=encryptToken(refreshToken);
  await db.$transaction(async tx=>{
    // Keep the pending state until the same transaction that stores consent.
    // Disconnect/uninstall/redaction delete pending states, fencing off delayed
    // Google callbacks even when the external token exchange has succeeded.
    const claimed=await tx.googleAuthState.deleteMany({
      where:{stateHash,shop,expiresAt:{gt:new Date()}}
    });
    if(claimed.count!==1)throw new Error("Google OAuth state expired or revoked during authorization");
    await tx.searchConsoleConnection.upsert({
      where:{shop},create:{shop,property,encryptedRefresh,status:"active"},
      update:{property,encryptedRefresh,status:"active",lastSyncedAt:null}
    });
  });
}
async function googleRefresh(refreshToken:string){
  const {clientId,clientSecret}=secrets();
  const response=await googleFetch(GOOGLE_TOKEN,{
    method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
    body:new URLSearchParams({grant_type:"refresh_token",refresh_token:refreshToken,
      client_id:clientId,client_secret:clientSecret})
  });
  if(!response.access_token)throw new Error("Google refresh response missing access token");
  return String(response.access_token);
}
export async function syncOrganicMetrics(shop:string,now=new Date()){
  // Claim the shared merchant import lease BEFORE spending Google API quota.
  const stale=new Date(now.getTime()-20*60000);
  const claim=await db.searchConsoleConnection.updateMany({
    where:{shop,status:"active",OR:[{lastSyncStartedAt:null},{lastSyncStartedAt:{lt:stale}}]},
    data:{lastSyncStartedAt:now}
  });
  if(!claim.count)throw new Error("Search Console synchronization is already in progress");
  try{
    const connection=await db.searchConsoleConnection.findUniqueOrThrow({where:{shop}});
    // Older connections may have used a broad sc-domain property. Do not
    // continue importing misleading cross-host traffic under a legacy token.
    if(!isExactHttpsStorefrontProperty(connection.property)){
      throw new Error("Reconnect Search Console using an exact HTTPS URL-prefix property");
    }
    const token=await googleRefresh(decryptToken(connection.encryptedRefresh));
    // 56 Pacific calendar days, excluding the three most recent days.
    // Google may still omit finalized dates; the scorecard abstains on gaps.
    const {startDate,endDate}=gscReportingWindow(now);
    const result=await googleFetch(GSC_BASE+"/sites/"+encodeURIComponent(connection.property)+"/searchAnalytics/query",{
      method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
      body:JSON.stringify({startDate,endDate,dimensions:["date"],type:"web",
        dataState:"final",rowLimit:250,aggregationType:"byProperty"})
    });
    // A successful HTTP response is not proof of the requested metric scope.
    // Refuse page-aggregated or malformed data rather than misleading merchants.
    assertPropertyAggregation(result.responseAggregationType);
    // Google may omit `rows` when no data exists. Explicit null, false, zero
    // or empty string are malformed, not a valid empty snapshot. `|| []`
    // would silently erase prior observations during snapshot reconciliation.
    const rows=parseSearchConsoleRows(result.rows===undefined?[]:result.rows,startDate,endDate);
    await db.$transaction(async tx=>{
      // Revalidate consent and the exact lease before writing any observations.
      // This conditional UPDATE locks the connection row until commit on PostgreSQL.
      // A concurrent disconnect/redaction then deletes the imported rows after
      // this transaction, or wins first and causes this transaction to roll back.
      // It also rejects results from an obsolete OAuth token or stolen sync lease.
      const active=await tx.searchConsoleConnection.updateMany({
        where:{
          shop,status:"active",property:connection.property,
          encryptedRefresh:connection.encryptedRefresh,lastSyncStartedAt:now
        },
        data:{lastSyncedAt:now,lastSyncStartedAt:null}
      });
      if(active.count!==1)throw new Error("Search Console consent or sync lease changed during import");
      // A later successful Google snapshot may omit a previously reported date.
      // Keeping the old observation would falsely satisfy the 28-day coverage
      // gate and combine measurements from different snapshots. Reconcile only
      // this shop, property, and requested date range, inside the consent lock.
      const observedDates=rows.map(row=>row.date);
      await tx.organicDailyMetric.deleteMany({
        where:{
          shop,property:connection.property,
          date:{gte:startDate,lte:endDate,
            ...(observedDates.length?{notIn:observedDates}:{})}
        }
      });
      for(const row of rows){
        await tx.organicDailyMetric.upsert({
          where:{shop_property_date:{shop,property:connection.property,date:row.date}},
          create:{shop,property:connection.property,...row},
          update:{clicks:row.clicks,impressions:row.impressions,ctr:row.ctr,position:row.position,importedAt:new Date()}
        });
      }
    });
    return {rows:rows.length,property:connection.property};
  }catch(error){
    await db.searchConsoleConnection.updateMany({
      where:{shop,lastSyncStartedAt:now},data:{lastSyncStartedAt:null}
    }).catch(()=>{});
    throw error;
  }
}
export async function disconnectGoogle(shop:string){
  const connection=await db.searchConsoleConnection.findUnique({where:{shop}});
  // Erase local data even if Google revocation is temporarily unavailable.
  // Delete the connection FIRST. The importer locks that row before inserting
  // metrics; this ordering serializes revocation against any in-flight import.
  await db.$transaction([
    db.searchConsoleConnection.deleteMany({where:{shop}}),
    db.organicDailyMetric.deleteMany({where:{shop}}),
    db.googleAuthState.deleteMany({where:{shop}})
  ]);
  if(connection){
    try{
      const token=decryptToken(connection.encryptedRefresh);
      await fetch("https://oauth2.googleapis.com/revoke",{
        method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
        body:new URLSearchParams({token}),signal:AbortSignal.timeout(5000)
      });
    }catch{
      console.warn("Google token revocation could not be confirmed; local credential deleted");
    }
  }
}
