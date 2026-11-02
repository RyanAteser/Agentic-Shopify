import db from "../db.server";
import {decryptToken,encryptToken} from "./gsc-crypto.server";
import {assertPropertyAggregation,gscReportingWindow,isExactHttpsStorefrontProperty,matchesPrimaryDomain,parseSearchConsoleRows} from "./growth";
import {readShopifySeoCatalog} from "./shopify-product-sample";
import {primaryDomainForShop} from "./ranking-ingest.server";
import {gscPageQuery,parseGscPageResponse,selectGscProductUrls,type GscProductDay} from "./gsc-page-metrics";

const SCOPE="https://www.googleapis.com/auth/webmasters.readonly";
const GOOGLE_AUTHORIZE="https://accounts.google.com/o/oauth2/v2/auth";
const GOOGLE_TOKEN="https://oauth2.googleapis.com/token";
const GSC_BASE="https://www.googleapis.com/webmasters/v3";

// Consent ordering uses a serialized database counter, not wall-clock time.
// The clock helper remains for an audit timestamp only. Never use timestamps
// to decide whether a delayed Connect precedes a merchant's Disconnect.
export async function databaseConsentTime(client:Pick<typeof db,"$queryRaw">=db):Promise<Date>{
  const postgres=/^postgres(?:ql)?:\/\//i.test(process.env.DATABASE_URL??"");
  const rows=postgres
    ?await client.$queryRaw<Array<{instant:Date}>>`SELECT clock_timestamp() AS instant`
    :await client.$queryRaw<Array<{instant:string}>>`SELECT strftime('%Y-%m-%dT%H:%M:%fZ','now') AS instant`;
  const raw=rows[0]?.instant;
  const instant=raw instanceof Date?raw:new Date(raw);
  if(!Number.isFinite(instant.getTime()))throw new Error("Database consent clock unavailable");
  return instant;
}

/** Capture Connect intent before asynchronous Shopify authentication. The
 * atomic increment is committed before returning; no external HTTP work
 * occurs while holding the counter row lock. SQLite db push may not seed
 * the singleton, so native upsert initializes it atomically if absent. */
export async function nextGoogleConsentOrder():Promise<bigint>{
  const row=await db.gscConsentOrderCounter.upsert({
    where:{id:1},create:{id:1,sequence:1n},
    update:{sequence:{increment:1}},select:{sequence:true}
  });
  return row.sequence;
}

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
/**
 * Begin OAuth only while the authenticated Shopify Session still exists.
 * Redaction deletes Session first, then StoreConfig and pending states.
 * This transaction uses that same lock order, so a request delayed past
 * uninstall cannot create a fresh state or resurrect merchant configuration.
 * The StoreConfig lock also serializes concurrent per-shop state limits.
 */
export async function beginGoogleAuthorization(
  shop:string,sessionId:string,stateHash:string,requestOrder:bigint
):Promise<"created"|"session_missing"|"rate_limited"|"revoked"> {
  if(!/^[a-f0-9]{64}$/.test(stateHash)||typeof requestOrder!=="bigint"||requestOrder<=0n){
    throw new Error("Invalid Google authorization request");
  }
  return db.$transaction(async (tx):Promise<"created"|"session_missing"|"rate_limited"|"revoked">=>{
    const active=await tx.session.updateMany({
      where:{id:sessionId,shop},data:{id:sessionId}
    });
    if(active.count!==1)return "session_missing";
    // Upsert UPDATE takes the merchant row lock also used by Disconnect.
    // A request that began before the last explicit revocation must not
    // resurrect a pending consent state after a slow Shopify authentication.
    const config=await tx.storeConfig.upsert({
      where:{shop},create:{shop},update:{updatedAt:new Date()}
    });
    if(requestOrder<=config.gscConsentRevokedOrder)return "revoked";
    const now=new Date();
    await tx.googleAuthState.deleteMany({where:{shop,expiresAt:{lte:now}}});
    const pending=await tx.googleAuthState.count({
      where:{shop,expiresAt:{gt:now}}
    });
    if(pending>=3)return "rate_limited";
    await tx.googleAuthState.create({
      data:{stateHash,shop,expiresAt:new Date(now.getTime()+10*60000)}
    });
    return "created";
  });
}

export async function storeGoogleConnection(shop:string,property:string,refreshToken:string,stateHash:string) {
  if(!isExactHttpsStorefrontProperty(property))throw new Error("Storefront-only metrics require an exact HTTPS URL-prefix property");
  const encryptedRefresh=encryptToken(refreshToken);
  await db.$transaction(async tx=>{
    // Lock the active merchant before consuming the state. Redaction deletes
    // StoreConfig before pending OAuth states, so a late callback cannot
    // recreate a Google connection even if a stale state was somehow present.
    const active=await tx.storeConfig.updateMany({
      where:{shop},data:{updatedAt:new Date()}
    });
    if(active.count!==1)throw new Error("Shopify merchant is no longer connected");
    // Keep the pending state until the same transaction that stores consent.
    // Disconnect/uninstall/redaction delete pending states, fencing off delayed
    // Google callbacks even when the external token exchange has succeeded.
    const claimed=await tx.googleAuthState.deleteMany({
      where:{stateHash,shop,expiresAt:{gt:new Date()}}
    });
    if(claimed.count!==1)throw new Error("Google OAuth state expired or revoked during authorization");
    // Re-consent starts a new measurement epoch. Lock the connection first,
    // then erase prior observations under the same transaction. Otherwise
    // reconnecting to an old property can display stale 28-day growth as new.
    // This ordering matches the importer (connection lock -> metric rows).
    const connectedAt=new Date();
    await tx.searchConsoleConnection.upsert({
      where:{shop},
      create:{shop,property,encryptedRefresh,status:"active",connectedAt},
      update:{property,encryptedRefresh,status:"active",connectedAt,
        lastSyncedAt:null,lastSyncStartedAt:null,lastPageSyncedAt:null,lastPageSyncStartedAt:null}
    });
    await tx.organicDailyMetric.deleteMany({where:{shop}});
    await tx.gscProductDailyMetric.deleteMany({where:{shop}});
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
/**
 * Merchant-triggered READ-ONLY Google page/day sync, for products returned by
 * this authenticated Shopify Admin session only.
 *
 * Separate lease from property-wide metrics. No store writes, paid AI or
 * external competitor URL imports. A failed GSC page response rolls back the
 * entire snapshot and never claims zero-traffic days for omitted dates.
 */
export async function syncGscProductPages(
  shop:string,admin:{graphql:(query:string,options?:any)=>Promise<{json:()=>Promise<any>}>},
  now=new Date()
):Promise<{pages:number;observedRows:number;property:string;hasMore:boolean}> {
  // Ask Shopify to attest its primary domain; no caller-supplied host or URLs.
  const primaryHost=await primaryDomainForShop(admin,shop);
  const catalog=await readShopifySeoCatalog(admin);
  const selected=selectGscProductUrls(catalog.products,primaryHost);
  if(!selected.length)throw new Error("No usable HTTPS product URLs from this store; page sync not possible");
  const stale=new Date(now.getTime()-20*60000);
  const rateLimit=new Date(now.getTime()-60*60000);
  const claimed=await db.searchConsoleConnection.updateMany({
    where:{
      shop,status:"active",
      property:"https://"+primaryHost+"/",
      OR:[{lastPageSyncStartedAt:null},{lastPageSyncStartedAt:{lt:stale}}],
      AND:[{OR:[{lastPageSyncedAt:null},{lastPageSyncedAt:{lt:rateLimit}}]}]
    },
    data:{lastPageSyncStartedAt:now}
  });
  if(claimed.count!==1)throw new Error("GSC page reporting requires current verified consent and an available hourly sync lease");
  try {
    const connection=await db.searchConsoleConnection.findUniqueOrThrow({where:{shop}});
    if(connection.status!=="active"||connection.property!=="https://"+primaryHost+"/"||
       !isExactHttpsStorefrontProperty(connection.property)){
      throw new Error("GSC page scope no longer matches authenticated merchant");
    }
    const token=await googleRefresh(decryptToken(connection.encryptedRefresh));
    const {startDate,endDate}=gscReportingWindow(now);
    const allRows:GscProductDay[]=[];
    for(const pageUrl of selected){
      const payload=await googleFetch(
        GSC_BASE+"/sites/"+encodeURIComponent(connection.property)+"/searchAnalytics/query",
        {method:"POST",headers:{"Authorization":"Bearer "+token,"Content-Type":"application/json"},
          body:JSON.stringify(gscPageQuery(pageUrl,startDate,endDate))}
      );
      allRows.push(...parseGscPageResponse(payload,pageUrl,startDate,endDate));
    }
    await db.$transaction(async tx=>{
      // The conditional UPDATE takes the connection lock on PostgreSQL and
      // fences off Disconnect, re-consent, revocation and stale import leases.
      const active=await tx.searchConsoleConnection.updateMany({
        where:{
          shop,status:"active",property:connection.property,
          encryptedRefresh:connection.encryptedRefresh,lastPageSyncStartedAt:now
        },
        data:{lastPageSyncedAt:now,lastPageSyncStartedAt:null}
      });
      if(active.count!==1)throw new Error("GSC consent or page sync lease changed during import");
      // Atomically replace the previous merchant-scoped sample. A later Google
      // snapshot may omit prior rows, so retaining them would fake coverage.
      await tx.gscProductDailyMetric.deleteMany({where:{shop}});
      if(allRows.length)await tx.gscProductDailyMetric.createMany({
        data:allRows.map(row=>({
          shop,property:connection.property,pageUrl:row.pageUrl,date:row.date,
          clicks:row.clicks,impressions:row.impressions,ctr:row.ctr,position:row.position
        }))
      });
    });
    return {pages:selected.length,observedRows:allRows.length,property:connection.property,
      hasMore:catalog.hasMore||catalog.products.length>selected.length};
  } catch(error){
    await db.searchConsoleConnection.updateMany({
      where:{shop,lastPageSyncStartedAt:now},data:{lastPageSyncStartedAt:null}
    }).catch(()=>{});
    throw error;
  }
}

export async function disconnectGoogle(shop:string){
  // Capture the credential under the same merchant lock that serializes
  // re-consent. Reading before the transaction could revoke an obsolete token
  // while deleting a newer connection committed during the lock wait.
  const encryptedRefresh=await db.$transaction(async tx=>{
    // Same StoreConfig -> OAuth state -> connection -> metrics lock order as
    // callback finalization. A disconnect cannot deadlock a late callback
    // or leave its state behind after deleting the Google connection.
    // Lock the Shopify session first, matching initiation and uninstall.
    // A merchant may press Disconnect while a Connect request has not yet
    // created StoreConfig. Persist a revocation tombstone for active installs,
    // but never recreate merchant data after uninstall removed all sessions.
    const session=await tx.session.findFirst({where:{shop},select:{id:true}});
    const sessionLock=session?await tx.session.updateMany({
      where:{shop,id:session.id},data:{id:session.id}
    }):{count:0};
    if(sessionLock.count===1){
      await tx.storeConfig.upsert({
        where:{shop},create:{shop},update:{updatedAt:new Date()}
      });
    }else{
      // Legacy/test records may have no Session; revoke existing consent
      // without recreating a configuration for an uninstalled merchant.
      await tx.storeConfig.updateMany({
        where:{shop},data:{updatedAt:new Date()}
      });
    }
    // Advance the same database-serialized order as Connect, after the
    // merchant row lock. A late pre-disconnect Connect has a smaller order
    // even if worker/database clocks jump or two events share a millisecond.
    const revocation=await tx.gscConsentOrderCounter.upsert({
      where:{id:1},create:{id:1,sequence:1n},
      update:{sequence:{increment:1}},select:{sequence:true}
    });
    const revokedAt=await databaseConsentTime(tx);
    await tx.storeConfig.updateMany({
      where:{shop},data:{gscConsentRevokedOrder:revocation.sequence,gscConsentRevokedAt:revokedAt}
    });
    // Read the CURRENT connection only after acquiring the merchant lock.
    // Google HTTP revocation happens after commit, never inside the DB lock.
    const current=await tx.searchConsoleConnection.findUnique({
      where:{shop},select:{encryptedRefresh:true}
    });
    await tx.googleAuthState.deleteMany({where:{shop}});
    await tx.searchConsoleConnection.deleteMany({where:{shop}});
    await tx.organicDailyMetric.deleteMany({where:{shop}});
    await tx.gscProductDailyMetric.deleteMany({where:{shop}});
    return current?.encryptedRefresh??null;
  });
  if(encryptedRefresh){
    try{
      const token=decryptToken(encryptedRefresh);
      const response=await fetch("https://oauth2.googleapis.com/revoke",{
        method:"POST",headers:{"content-type":"application/x-www-form-urlencoded"},
        body:new URLSearchParams({token}),signal:AbortSignal.timeout(5000)
      });
      // An HTTP 4xx/5xx is not proof of successful Google revocation.
      if(!response.ok)throw new Error("Google revocation not confirmed");
    }catch{
      // Never log raw upstream responses, refresh tokens, or merchant data.
      console.warn("Google token revocation could not be confirmed; local credential deleted");
    }
  }
}
