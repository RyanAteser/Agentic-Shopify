import {test} from "node:test";
import assert from "node:assert/strict";
import {hashOpenAiResponseId} from "../app/lib/blog-usage";
import {parseOperatorBillingExtract,parseProviderUsageExport,
  reconcileBlogProviderUsage,type WorkerBlogUsageEvidence
} from "../app/lib/provider-usage-reconciliation";

const shop="test-merchant.myshopify.com";
const month="2026-11";
const author="chatcmpl_sample_writer_001",editor="chatcmpl_sample_editor_002";
const worker:WorkerBlogUsageEvidence[]=[
  {shop,jobId:"job_sample_001",stage:"writer",provider:"openai-chat-completions",
    model:"gpt-4.1-mini-2025-04-14",inputTokens:1000,outputTokens:500,
    responseIdHash:hashOpenAiResponseId(author)},
  {shop,jobId:"job_sample_001",stage:"editor",provider:"openai-chat-completions",
    model:"gpt-4.1-mini-2025-04-14",inputTokens:1200,outputTokens:600,
    responseIdHash:hashOpenAiResponseId(editor)}
];
const req=(responseId:string,inputTokens:number,outputTokens:number)=>({
  responseId,model:"gpt-4.1-mini-2025-04-14",
  inputTokens,outputTokens,createdAt:"2026-11-10T12:00:00.000Z"
});
const exportData=()=>({
  schemaVersion:1,provider:"openai-chat-completions",period:month,
  accountScope:"operator_claimed_dedicated",
  exportDescription:"Operator provided synthetic provider request export, NOT invoice",
  records:[req(author,1000,500),req(editor,1200,600)]
});
const invoice=()=>({
  schemaVersion:1,provider:"openai-chat-completions",
  period:month,currency:"USD",totalBilledCents:22,
  accountScope:"operator_claimed_dedicated",
  sourceDescription:"Operator supplied aggregate account invoice, unverified"
});
test("exact response hashes, models and tokens cross-check without claiming profit or verified billing",()=>{
  const report=reconcileBlogProviderUsage(shop,month,worker,exportData(),invoice());
  assert.equal(report.exactlyMatchedCount,2);
  assert.equal(report.inconsistentMatchedCount,0);
  assert.equal(report.workerNotInExportCount,0);
  assert.equal(report.providerNotInWorkerCount,0);
  assert.equal(report.matchedProviderInputTokens,2200);
  assert.equal(report.matchedProviderOutputTokens,1100);
  assert.equal(report.accountWideBilledCents,22);
  assert.equal(report.merchantBilledCents,null);
  assert.equal(report.realizedProfitCents,null);
  assert.equal(report.vendorInvoiceVerified,false);
  assert.equal(report.completeness,"unproven");
  assert.ok(report.warnings.some(x=>x.includes("not independently authenticated")));
  assert.equal(JSON.stringify(report).includes(author),false);
  assert.equal(JSON.stringify(report).includes(editor),false);
});
test("provider-only request after failed editor is unassigned and never free",()=>{
  const input=exportData();
  input.records.push(req("chatcmpl_failed_second_editor_003",700,800));
  const report=reconcileBlogProviderUsage(shop,month,worker,input);
  assert.equal(report.providerNotInWorkerCount,1);
  assert.equal(report.exactlyMatchedCount,2);
  assert.equal(report.merchantBilledCents,null);
  assert.equal(report.completeness,"conflicting");
  assert.deepEqual(report.issues.filter(x=>x.kind==="provider_request_not_in_worker")
    .map(x=>[x.kind,x.jobId]),[["provider_request_not_in_worker",null]]);
});
test("shared provider account evidence cannot allocate unmatched calls to merchant",()=>{
  const input={...exportData(),accountScope:"shared" as const};
  input.records.push(req("chatcmpl_unrelated_tenant_003",400,500));
  const r=reconcileBlogProviderUsage(shop,month,worker,input);
  assert.equal(r.providerNotInWorkerCount,1);
  assert.equal(r.completeness,"unproven");
  assert.equal(r.merchantBilledCents,null);
  assert.match(r.warnings.join(" "),/Shared provider account/);
});
test("token and model mismatches become explicit falsifiers, not an estimated cost",()=>{
  const exportObj=exportData();
  exportObj.records[0]={...exportObj.records[0],inputTokens:1001,
    outputTokens:600,model:"other-model"};
  const r=reconcileBlogProviderUsage(shop,month,worker,exportObj);
  assert.equal(r.exactlyMatchedCount,1);
  assert.equal(r.inconsistentMatchedCount,1);
  assert.equal(r.completeness,"conflicting");
  assert.deepEqual(r.issues.map(x=>x.kind).sort(),
    ["input_token_mismatch","model_mismatch","output_token_mismatch"].sort());
  assert.equal(r.merchantBilledCents,null);
});
test("missing response digest, unseen provider IDs and unknown request charges cannot be silently reconciled",()=>{
  const r=reconcileBlogProviderUsage(shop,month,[
    {...worker[0],responseIdHash:null},worker[1]],exportData());
  assert.equal(r.exactlyMatchedCount,1);
  assert.equal(r.workerWithoutResponseIdCount,1);
  assert.equal(r.providerNotInWorkerCount,1);
  assert.equal(r.completeness,"conflicting");
  const missing=reconcileBlogProviderUsage(shop,month,worker,{
    ...exportData(),records:[req(author,1000,500)]
  });
  assert.equal(missing.workerNotInExportCount,1);
});
test("duplicate provider request IDs, duplicate worker linkage and foreign tenant rows fail closed",()=>{
  assert.throws(()=>parseProviderUsageExport({
    ...exportData(),records:[req(author,1000,500),req(author,1000,500)]
  }),/Duplicate provider response ID/);
  assert.throws(()=>reconcileBlogProviderUsage(shop,month,[
    worker[0],{...worker[0],stage:"editor",jobId:"job_sample_002"}
  ],exportData()),/linked to multiple/);
  assert.throws(()=>reconcileBlogProviderUsage(shop,month,[
    {...worker[0],shop:"other.myshopify.com"}
  ],exportData()),/foreign-tenant/);
  assert.throws(()=>reconcileBlogProviderUsage(shop,month,[
    worker[0],worker[0]
  ],exportData()),/Duplicate job\/stage/);
});
test("reject malformed timestamps, token values, mismatched invoice scopes and billing months",()=>{
  assert.throws(()=>parseProviderUsageExport({
    ...exportData(),records:[{...req(author,1000,500),createdAt:"2026-10-31T23:59:59Z"}]
  }),/outside requested UTC period/);
  assert.throws(()=>parseProviderUsageExport({
    ...exportData(),records:[req(author,-1,500)]
  }),/Invalid provider input tokens/);
  assert.throws(()=>parseProviderUsageExport({
    ...exportData(),records:[req(author,0,0)]
  }),/token observation missing/);
  assert.throws(()=>parseOperatorBillingExtract({...invoice(),totalBilledCents:NaN}),
    /Invalid account-wide billing cents/);
  assert.throws(()=>reconcileBlogProviderUsage(shop,"2026-10",worker,exportData()),
    /period differ/);
  assert.throws(()=>reconcileBlogProviderUsage(shop,month,worker,exportData(),
    {...invoice(),accountScope:"shared"}),/scopes do not match/);
  assert.throws(()=>reconcileBlogProviderUsage(shop,month,worker,exportData(),
    {...invoice(),currency:"EUR"}),/schema\/currency/);
});
