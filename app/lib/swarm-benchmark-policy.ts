import type {VerifiedShopifySnapshot} from "./swarm-evidence.server";

export type BenchmarkLabel="YES"|"NO"|"INSUFFICIENT";
export type BenchmarkCaseId="null_urls_are_not_depublication"|"google_indexing_requires_independent_evidence";
export type BenchmarkCase={
  id:BenchmarkCaseId;question:string;
  baseline:string;rejectionRule:string;metric:string;
  // Deterministic oracle is computed from the frozen authenticated snapshot;
  // never embedded in a provider prompt.
  expected:(facts:VerifiedShopifySnapshot)=>BenchmarkLabel;
};
export const BENCHMARK_CASES:readonly BenchmarkCase[]=[
  {
    id:"null_urls_are_not_depublication",
    question:"Does a null onlineStoreUrl for every active published product prove that zero active products are published to the Online Store?",
    baseline:"The claim being evaluated is that zero non-null onlineStoreUrl values proves zero active products are published. Challenge it against the supplied Shopify Admin counts.",
    rejectionRule:"Reject the asserted depublication implication if active published products exist despite null onlineStoreUrl values.",
    metric:"Check count of active Online Store-published products and count of non-null onlineStoreUrl in exactly the same frozen Shopify Admin source.",
    expected:f=>f.publishedActiveProductsInSample>0&&f.publishedProductsWithOnlineStoreUrl===0?"NO":"INSUFFICIENT"
  },
  {
    id:"google_indexing_requires_independent_evidence",
    question:"Does this authenticated Shopify Admin snapshot establish that Google's search index currently contains any product page from the store?",
    baseline:"The claim is that publication and password metadata alone demonstrate actual Google indexing. Assess only the source fields supplied and do not fabricate Search Console records.",
    rejectionRule:"Reject confirmed indexation claims if the supplied source contains no Google index inspection evidence.",
    metric:"Separate confirmed Shopify Admin product/channel status from observed Google indexing or URL Inspection results.",
    expected:()=> "INSUFFICIENT"
  }
] as const;

export function benchmarkBrief(spec:BenchmarkCase){
  const format="The JSON text field must begin on its own first line with ANSWER: LABEL. Replace LABEL with exactly one of YES, NO, INSUFFICIENT selected from the verified facts. Every worker should form an independent decision, and revise it if challenged by real counterevidence. Explain uncertainty and the best falsifier. Do not fabricate missing search-index data.";
  return {
    title:spec.question,
    hypothesis:spec.baseline+" "+format,
    metric:spec.metric,
    rejectionRule:spec.rejectionRule
  };
}
export function parseBenchmarkAnswer(text:unknown):BenchmarkLabel|null{
  if(typeof text!=="string")return null;
  const x=text.trimStart().match(/^ANSWER:\s*(YES|NO|INSUFFICIENT)\s*(?:\r?\n|$)/i);
  return x ? x[1].toUpperCase() as BenchmarkLabel : null;
}
export function scoreBenchmarkCase(input:{
  spec:BenchmarkCase;facts:VerifiedShopifySnapshot;
  singleAnswer:unknown;swarmAnswer:unknown;
  singleTokens:{input:number;output:number};
  swarmTokens:{input:number;output:number};
}){
  const expected=input.spec.expected(input.facts);
  const single=parseBenchmarkAnswer(input.singleAnswer);
  const swarm=parseBenchmarkAnswer(input.swarmAnswer);
  const price={inputPerMillionUsd:0.75,outputPerMillionUsd:3.75};
  const estimate=(a:{input:number;output:number})=>{
    if(!Number.isSafeInteger(a.input)||a.input<0||!Number.isSafeInteger(a.output)||a.output<0){
      throw new Error("Invalid token quantities for benchmark reporting.");
    }
    return (a.input*price.inputPerMillionUsd+a.output*price.outputPerMillionUsd)/1_000_000;
  };
  return {
    id:input.spec.id,expected,
    single:{answer:single,correct:single===expected,inputTokens:input.singleTokens.input,
      outputTokens:input.singleTokens.output,illustrativePaidUsd:estimate(input.singleTokens)},
    swarm:{answer:swarm,correct:swarm===expected,inputTokens:input.swarmTokens.input,
      outputTokens:input.swarmTokens.output,illustrativePaidUsd:estimate(input.swarmTokens)},
    limitation:"Single closed-book snapshot per case; no independently observed Google indexing or production merchant SEO uplift. Paid cost estimate is not an invoice."
  };
}
