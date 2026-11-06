import type {VerifiedShopifySnapshot} from "./swarm-evidence.server";
import type {BenchmarkLabel} from "./swarm-benchmark-policy";
import type {SnapshotSourceFact} from "./swarm-execution-policy";

/**
 * Trusted, deterministic answers are available ONLY for exact, reviewed
 * question templates. An arbitrary user/LLM-authored research question is
 * NOT automatically verifiable merely because it cites a correct data field.
 * Template matches are exact, case-sensitive and versioned.
 */
export const TRUSTED_QUESTION_POLICY="verified-shopify-fact-v1" as const;
type TemplateSpec={field:SnapshotSourceFact["field"];evaluate:(s:VerifiedShopifySnapshot)=>BenchmarkLabel};
const complete=(s:VerifiedShopifySnapshot)=>!s.allProductsHasNextPage&&!s.publishedProductsHasNextPage;
const published=(s:VerifiedShopifySnapshot)=>s.publishedActiveProductsInSample;
const noPubUrls=(s:VerifiedShopifySnapshot)=>s.publishedProductsWithOnlineStoreUrl===0;
const yesNo=(b:boolean):BenchmarkLabel=>b?"YES":"NO";
const t:Readonly<Record<string,TemplateSpec>>={
  "Is storefront password protection enabled?":{
    field:"storefrontPasswordEnabled",evaluate:s=>yesNo(s.storefrontPasswordEnabled)
  },
  "Is storefront password protection disabled?":{
    field:"storefrontPasswordEnabled",evaluate:s=>yesNo(!s.storefrontPasswordEnabled)
  },
  "Do null product URLs prove no Online Store publication?":{
    field:"publishedActiveProductsInSample",
    evaluate:s=>complete(s)&&published(s)>0&&noPubUrls(s)?"NO":"INSUFFICIENT"
  },
  "Do null URLs prove no active channel publication?":{
    field:"publishedActiveProductsInSample",
    evaluate:s=>complete(s)&&published(s)>0&&noPubUrls(s)?"NO":"INSUFFICIENT"
  },
  "Does this complete sample contain any active Online Store-published products?":{
    field:"publishedActiveProductsInSample",
    evaluate:s=>complete(s)?yesNo(published(s)>0):"INSUFFICIENT"
  },
  "Does any published product have a non-null onlineStoreUrl here?":{
    field:"publishedProductsWithOnlineStoreUrl",
    evaluate:s=>complete(s)?yesNo(s.publishedProductsWithOnlineStoreUrl>0):"INSUFFICIENT"
  },
  "Are all published products missing a non-null onlineStoreUrl here?":{
    field:"publishedProductsWithOnlineStoreUrl",
    evaluate:s=>complete(s)&&s.publishedProductsSampled>0?yesNo(noPubUrls(s)):"INSUFFICIENT"
  },
  "Is the entire observed product sample complete in both channels?":{
    field:"allProductsSampled",evaluate:s=>yesNo(complete(s))
  },
  "Do active Online Store-published products exist in this authenticated Artemis developer catalog?":{
    field:"publishedActiveProductsInSample",
    evaluate:s=>complete(s)?yesNo(published(s)>0):"INSUFFICIENT"
  },
  "Is storefront password protection enabled for this authenticated Artemis developer shop?":{
    field:"storefrontPasswordEnabled",evaluate:s=>yesNo(s.storefrontPasswordEnabled)
  }
};
export function trustedQuestionTruth(title:string,s:VerifiedShopifySnapshot):
  null|{label:BenchmarkLabel;sourceFact:SnapshotSourceFact;policy:typeof TRUSTED_QUESTION_POLICY}{
  const spec=t[title];
  if(!spec)return null;
  const label=spec.evaluate(s);
  return {
    label,policy:TRUSTED_QUESTION_POLICY,
    sourceFact:{field:spec.field,value:String(s[spec.field])}
  };
}
