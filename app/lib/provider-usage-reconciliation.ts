import {hashOpenAiResponseId} from "./blog-usage";

/**
 * Reconcile an operator-supplied provider request export against persisted
 * n8n-reported Blog Agent usage. This is an ID/token cross-check only.
 *
 * Provider request exports are not invoices, and even an exact token match
 * does NOT prove that a particular amount was billed or paid.
 */
export type WorkerBlogUsageEvidence={
  shop:string;jobId:string;stage:string;provider:string;model:string;
  inputTokens:number;outputTokens:number;responseIdHash:string|null;
};
export type ProviderUsageRecord={
  responseId:string;model:string;inputTokens:number;outputTokens:number;
  createdAt:string;
};
export type ProviderUsageExport={
  schemaVersion:1;
  provider:"openai-chat-completions";
  period:string;
  accountScope:"shared"|"operator_claimed_dedicated";
  exportDescription:string;
  records:ProviderUsageRecord[];
};
export type OperatorBillingExtract={
  schemaVersion:1;
  provider:"openai-chat-completions";
  period:string;
  currency:"USD";
  totalBilledCents:number;
  accountScope:"shared"|"operator_claimed_dedicated";
  sourceDescription:string;
};
export type ReconciliationIssue={
  kind:"worker_missing_response_id"|"worker_request_not_in_export"|
    "provider_request_not_in_worker"|"model_mismatch"|
    "input_token_mismatch"|"output_token_mismatch";
  stage:string|null;
  jobId:string|null;
};
export type ProviderReconciliation={
  shop:string;jobCohortMonth:string;
  providerExportMonth:string;
  providerAccountScope:"shared"|"operator_claimed_dedicated";
  operatorSuppliedEvidenceOnly:true;
  vendorInvoiceVerified:false;
  merchantBilledCents:null;
  realizedProfitCents:null;
  workerReceiptCount:number;
  providerRequestCount:number;
  exactlyMatchedCount:number;
  inconsistentMatchedCount:number;
  workerWithoutResponseIdCount:number;
  workerNotInExportCount:number;
  providerNotInWorkerCount:number;
  matchedProviderInputTokens:number;
  matchedProviderOutputTokens:number;
  accountWideBilledCents:number|null;
  billedAmountAttribution:"none_account_wide_only";
  completeness:"unproven"|"conflicting";
  issues:ReconciliationIssue[];
  warnings:string[];
};
function obj(x:unknown,label:string):Record<string,unknown>{
  if(x===null||typeof x!=="object"||Array.isArray(x))
    throw new Error("Invalid "+label+" object");
  return x as Record<string,unknown>;
}
function month(x:unknown,label:string):string{
  if(typeof x!=="string"||!/^(20[2-9]\d)-(0[1-9]|1[0-2])$/.test(x))
    throw new Error("Invalid "+label+" YYYY-MM");
  return x;
}
function money(x:unknown,label:string):number{
  if(!Number.isSafeInteger(x)||typeof x!=="number"||x<0||x>1e11)
    throw new Error("Invalid "+label+" cents");
  return x;
}
function tokens(x:unknown,label:string):number{
  if(typeof x!=="number"||!Number.isSafeInteger(x)||x<0||x>1e9)
    throw new Error("Invalid "+label+" tokens");
  return x;
}
function name(x:unknown,label:string):string{
  if(typeof x!=="string"||!/^[A-Za-z0-9._-]{1,90}$/.test(x))
    throw new Error("Invalid "+label);
  return x;
}
function label(x:unknown,field:string):string{
  if(typeof x!=="string"||x.length<8||x.length>300||
     /[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(x))
    throw new Error("Invalid "+field);
  return x;
}
function scope(x:unknown):ProviderUsageExport["accountScope"]{
  if(x!=="shared"&&x!=="operator_claimed_dedicated")
    throw new Error("Invalid provider account scope");
  return x;
}
function validCreatedAt(x:unknown,period:string):void{
  // Deterministic and explicitly UTC: no offsets or locale ambiguities.
  if(typeof x!=="string"||
      !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(x)||
      !Number.isFinite(Date.parse(x))||
      new Date(x).toISOString().slice(0,7)!==period)
    throw new Error("Provider request timestamp outside requested UTC period");
}
export function parseProviderUsageExport(raw:unknown):ProviderUsageExport{
  const x=obj(raw,"provider export");
  if(x.schemaVersion!==1||x.provider!=="openai-chat-completions")
    throw new Error("Unsupported provider usage export schema");
  const p=month(x.period,"provider export period");
  const accountScope=scope(x.accountScope);
  const exportDescription=label(x.exportDescription,"provider export description");
  if(!Array.isArray(x.records)||x.records.length>10000)
    throw new Error("Invalid provider request export row count");
  const seen=new Set<string>();
  const records:ProviderUsageRecord[]=[];
  for(const rawRecord of x.records){
    const r=obj(rawRecord,"provider request");
    const responseId=name(r.responseId,"provider response ID");
    if(responseId.length<8||responseId.length>128)
      throw new Error("Invalid provider response ID length");
    const digest=hashOpenAiResponseId(responseId);
    if(seen.has(digest))
      throw new Error("Duplicate provider response ID: export is not reliable");
    seen.add(digest);
    const model=name(r.model,"provider model");
    const inputTokens=tokens(r.inputTokens,"provider input");
    const outputTokens=tokens(r.outputTokens,"provider output");
    if(inputTokens+outputTokens===0)throw new Error("Provider token observation missing");
    validCreatedAt(r.createdAt,p);
    records.push({responseId,model,inputTokens,outputTokens,createdAt:r.createdAt as string});
  }
  return {schemaVersion:1,provider:"openai-chat-completions",period:p,
    accountScope,exportDescription,records};
}
export function parseOperatorBillingExtract(raw:unknown):OperatorBillingExtract{
  const x=obj(raw,"operator billing extract");
  if(x.schemaVersion!==1||x.provider!=="openai-chat-completions"||
     x.currency!=="USD")
    throw new Error("Unsupported billing extract schema/currency");
  return {schemaVersion:1,provider:"openai-chat-completions",
    period:month(x.period,"billing period"),currency:"USD",
    totalBilledCents:money(x.totalBilledCents,"account-wide billing"),
    accountScope:scope(x.accountScope),
    sourceDescription:label(x.sourceDescription,"billing source description")};
}

/**
 * This function NEVER asserts invoice-grade merchant cost, even when a
 * request export, operator billing extract and all worker IDs match.
 */
export function reconcileBlogProviderUsage(
  shop:string,jobCohortMonth:string,
  workerReceipts:readonly WorkerBlogUsageEvidence[],
  rawExport:unknown,rawBilling?:unknown
):ProviderReconciliation{
  if(typeof shop!=="string"||
     !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop))
    throw new Error("Invalid exact Shopify tenant");
  const m=month(jobCohortMonth,"job cohort month");
  const provider=parseProviderUsageExport(rawExport);
  // The initial audit compares a cohort against ONE calendar-month export.
  // Cross-month receipts must be investigated separately, not silently joined.
  if(provider.period!==m)throw new Error("Cohort and provider export period differ; no automatic allocation");
  const billing=rawBilling===undefined?null:parseOperatorBillingExtract(rawBilling);
  if(billing&&(billing.period!==provider.period||
      billing.accountScope!==provider.accountScope))
    throw new Error("Provider export and billing periods or scopes do not match");
  if(!Array.isArray(workerReceipts)||workerReceipts.length>10000)
    throw new Error("Invalid worker receipt row count");
  const workerByDigest=new Map<string,WorkerBlogUsageEvidence>();
  const withoutId:WorkerBlogUsageEvidence[]=[];
  const jobStages=new Set<string>();
  for(const receipt of workerReceipts){
    if(receipt.shop!==shop||typeof receipt.jobId!=="string"||
       receipt.jobId.length<8||receipt.jobId.length>128||
       !["writer","editor"].includes(receipt.stage)||
       receipt.provider!=="openai-chat-completions")
      throw new Error("Invalid or foreign-tenant worker receipt");
    const stageKey=receipt.jobId+"/"+receipt.stage;
    if(jobStages.has(stageKey))throw new Error("Duplicate job/stage worker evidence");
    jobStages.add(stageKey);
    name(receipt.model,"worker model");
    tokens(receipt.inputTokens,"worker input");
    tokens(receipt.outputTokens,"worker output");
    if(receipt.inputTokens+receipt.outputTokens===0)
      throw new Error("Worker token evidence missing");
    if(receipt.responseIdHash===null){withoutId.push(receipt);continue;}
    if(typeof receipt.responseIdHash!=="string"||
       !/^[a-f0-9]{64}$/.test(receipt.responseIdHash))
      throw new Error("Malformed stored provider response digest");
    if(workerByDigest.has(receipt.responseIdHash))
      throw new Error("One provider response linked to multiple job/stage receipts");
    workerByDigest.set(receipt.responseIdHash,receipt);
  }
  const issues:ReconciliationIssue[]=[];
  for(const receipt of withoutId)
    issues.push({kind:"worker_missing_response_id",stage:receipt.stage,jobId:receipt.jobId});
  let matched=0,mismatched=0,providerOnly=0,matchedInput=0,matchedOutput=0;
  const seen=new Set<string>();
  for(const request of provider.records){
    const digest=hashOpenAiResponseId(request.responseId);
    const receipt=workerByDigest.get(digest);
    if(!receipt){
      providerOnly++;
      issues.push({kind:"provider_request_not_in_worker",stage:null,jobId:null});
      continue;
    }
    seen.add(digest);
    const problems:ReconciliationIssue["kind"][]=[];
    if(receipt.model!==request.model)problems.push("model_mismatch");
    if(receipt.inputTokens!==request.inputTokens)problems.push("input_token_mismatch");
    if(receipt.outputTokens!==request.outputTokens)problems.push("output_token_mismatch");
    if(problems.length){
      mismatched++;
      for(const kind of problems)
        issues.push({kind,stage:receipt.stage,jobId:receipt.jobId});
    }else{
      matched++;
      matchedInput+=request.inputTokens;
      matchedOutput+=request.outputTokens;
    }
  }
  let workerOnly=0;
  for(const [digest,receipt] of workerByDigest){
    if(!seen.has(digest)){
      workerOnly++;
      issues.push({kind:"worker_request_not_in_export",stage:receipt.stage,jobId:receipt.jobId});
    }
  }
  const warnings=[
    "Provider usage export is operator-supplied and not independently authenticated.",
    "Matched request identities and tokens are NOT invoice-backed dollar charges.",
    "A job-creation month may differ from a provider request month; this audit cannot allocate across months.",
    "Failed writer/editor executions may incur requests without any final app callback.",
  ];
  if(provider.accountScope==="shared")
    warnings.push("Shared provider account requests cannot be assigned to this merchant without independent tenant attribution.");
  if(!billing)
    warnings.push("No operator billing total supplied; amount actually billed remains unknown.");
  else
    warnings.push("Operator-supplied billing total is account-wide, not a merchant line item; merchant cost remains unknown.");
  const conflict=mismatched>0||workerOnly>0||withoutId.length>0||
    (provider.accountScope==="operator_claimed_dedicated"&&providerOnly>0);
  return {
    shop,jobCohortMonth:m,providerExportMonth:provider.period,
    providerAccountScope:provider.accountScope,
    operatorSuppliedEvidenceOnly:true,vendorInvoiceVerified:false,
    merchantBilledCents:null,realizedProfitCents:null,
    workerReceiptCount:workerReceipts.length,
    providerRequestCount:provider.records.length,
    exactlyMatchedCount:matched,inconsistentMatchedCount:mismatched,
    workerWithoutResponseIdCount:withoutId.length,
    workerNotInExportCount:workerOnly,
    providerNotInWorkerCount:providerOnly,
    matchedProviderInputTokens:matchedInput,
    matchedProviderOutputTokens:matchedOutput,
    accountWideBilledCents:billing?.totalBilledCents??null,
    billedAmountAttribution:"none_account_wide_only",
    completeness:conflict?"conflicting":"unproven",
    issues,warnings
  };
}
