/**
 * Typed read-only Shopify Admin facts, not LLM assertions.
 * Returned fields intentionally omit product identities, private content,
 * access tokens and customer records.
 */
export const SHOPIFY_EVIDENCE_SENDER="shopify-admin-verified-snapshot";
export const SNAPSHOT_SOURCE="Shopify Admin GraphQL 2026-10 (authenticated)" as const;
export type VerifiedShopifySnapshot={
  source:typeof SNAPSHOT_SOURCE;
  shop:string;
  collectedAt:string;
  storefrontPasswordEnabled:boolean;
  allProductsSampled:number;
  allProductsHasNextPage:boolean;
  activeProductsInSample:number;
  allProductsWithOnlineStoreUrl:number;
  publishedProductsSampled:number;
  publishedProductsHasNextPage:boolean;
  publishedActiveProductsInSample:number;
  publishedProductsWithOnlineStoreUrl:number;
};

type ShopifyAdmin={
  graphql:(q:string)=>Promise<{json:()=>Promise<unknown>}>;
};
export class ShopifyGroundingError extends Error{
  constructor(message="Verified read-only Shopify evidence is unavailable."){
    super(message);this.name="ShopifyGroundingError";
  }
}

export function requireVerifiedShopifySnapshot(input:unknown,expectedShop:string,
  now=new Date()):VerifiedShopifySnapshot{
  if(!input||typeof input!=="object"||Array.isArray(input))throw new ShopifyGroundingError();
  const a=input as Record<string,unknown>;
  if(a.source!==SNAPSHOT_SOURCE||a.shop!==expectedShop||
     !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(expectedShop)||
     typeof a.collectedAt!=="string")throw new ShopifyGroundingError();
  const when=Date.parse(a.collectedAt);
  if(!Number.isFinite(when)||when>now.getTime()+60_000||
      now.getTime()-when>24*60*60*1000)throw new ShopifyGroundingError("Shopify evidence is stale.");
  for(const key of ["storefrontPasswordEnabled","allProductsHasNextPage",
    "publishedProductsHasNextPage"] as const)if(typeof a[key]!=="boolean")throw new ShopifyGroundingError();
  for(const key of ["allProductsSampled","activeProductsInSample",
    "allProductsWithOnlineStoreUrl","publishedProductsSampled",
    "publishedActiveProductsInSample","publishedProductsWithOnlineStoreUrl"] as const){
    const x=a[key];
    if(typeof x!=="number"||!Number.isSafeInteger(x)||x<0||x>40)throw new ShopifyGroundingError();
  }
  if((a.activeProductsInSample as number)>(a.allProductsSampled as number)||
     (a.allProductsWithOnlineStoreUrl as number)>(a.allProductsSampled as number)||
     (a.publishedActiveProductsInSample as number)>(a.publishedProductsSampled as number)||
     (a.publishedProductsWithOnlineStoreUrl as number)>(a.publishedProductsSampled as number)){
    throw new ShopifyGroundingError();
  }
  return input as VerifiedShopifySnapshot;
}

export async function captureVerifiedShopifySnapshot(
  admin:ShopifyAdmin,shop:string,now=new Date()
):Promise<VerifiedShopifySnapshot>{
  const query=`query SwarmTrustedReadOnlyStoreSnapshot {
    shop { myshopifyDomain }
    onlineStore { passwordProtection { enabled } }
    all:products(first:40) { nodes { status onlineStoreUrl } pageInfo { hasNextPage } }
    published:products(first:40,query:"published_status:published") {
      nodes { status onlineStoreUrl } pageInfo { hasNextPage }
    }
  }`;
  let body:unknown;
  try{
    const res=await admin.graphql(query);
    body=await res.json();
  }catch{throw new ShopifyGroundingError();}
  if(!body||typeof body!=="object"||Array.isArray(body))throw new ShopifyGroundingError();
  const r=body as {errors?:unknown[];data?:{
    shop?:{myshopifyDomain?:unknown};
    onlineStore?:{passwordProtection?:{enabled?:unknown}};
    all?:{nodes?:unknown;pageInfo?:{hasNextPage?:unknown}};
    published?:{nodes?:unknown;pageInfo?:{hasNextPage?:unknown}}
  }};
  const data=r.data;
  if(r.errors?.length||!data||data.shop?.myshopifyDomain!==shop||
    typeof data.onlineStore?.passwordProtection?.enabled!=="boolean"||
    !Array.isArray(data.all?.nodes)||!Array.isArray(data.published?.nodes)||
    typeof data.all?.pageInfo?.hasNextPage!=="boolean"||
    typeof data.published?.pageInfo?.hasNextPage!=="boolean")throw new ShopifyGroundingError();
  const clean=(nodes:unknown[])=>{
    if(nodes.length>40||nodes.some(n=>!n||typeof n!=="object"||
      !["ACTIVE","DRAFT","ARCHIVED"].includes((n as {status?:string}).status??"")||
      ((n as {onlineStoreUrl?:unknown}).onlineStoreUrl!==null &&
       typeof (n as {onlineStoreUrl?:unknown}).onlineStoreUrl!=="string"))){
      throw new ShopifyGroundingError();
    }
    const p=nodes as {status:string;onlineStoreUrl:string|null}[];
    return {count:p.length,active:p.filter(x=>x.status==="ACTIVE").length,
      withUrl:p.filter(x=>!!x.onlineStoreUrl).length};
  };
  const all=clean(data.all.nodes),published=clean(data.published.nodes);
  const snapshot:VerifiedShopifySnapshot={
    source:SNAPSHOT_SOURCE,shop,collectedAt:now.toISOString(),
    storefrontPasswordEnabled:data.onlineStore.passwordProtection.enabled,
    allProductsSampled:all.count,allProductsHasNextPage:data.all.pageInfo.hasNextPage,
    activeProductsInSample:all.active,allProductsWithOnlineStoreUrl:all.withUrl,
    publishedProductsSampled:published.count,
    publishedProductsHasNextPage:data.published.pageInfo.hasNextPage,
    publishedActiveProductsInSample:published.active,
    publishedProductsWithOnlineStoreUrl:published.withUrl
  };
  return requireVerifiedShopifySnapshot(snapshot,shop,now);
}
