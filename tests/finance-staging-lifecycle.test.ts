import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import {createServer} from "node:http";
import {once} from "node:events";
import db from "../app/db.server";
import {createCreditedJob} from "../app/lib/credits.server";
import {claimQueuedDispatch} from "../app/lib/dispatch-claim.server";
import {deliverClaimedN8nJob,UncertainDispatchError} from "../app/lib/n8n-delivery.server";
import {createArticleCallbackToken} from "../app/lib/article-callback-auth";
import {action as articleCallbackAction} from "../app/routes/api.agent.complete";
import {setBlogBudgetPolicy,BlogBudgetBlockedError} from "../app/lib/blog-budget.server";
import {loadBudgetExposure} from "../app/lib/budget-exposure.server";
import {loadObservedUsage} from "../app/lib/unit-economics.server";
import {evaluatePlan,type ScenarioAssumptions} from "../app/lib/unit-economics";
import {eraseMerchantData} from "../app/lib/merchant-redaction.server";

const month="2026-11";
const at=new Date("2026-11-10T12:00:00Z");
const env={BLOG_BUDGET_ENFORCE:"true"};
const article={
  title:"Choosing products for a specific need",
  summary:"Practical considerations for assessing product suitability.",
  keyword:"products",tags:["Guide"],
  body:"<h2>Evaluate the details</h2><p>Compare materials, fit, care requirements and the intended use. Check the product listing for manufacturer instructions and ask the merchant if specifications are unclear before making a decision.</p>"
};
const receipts=[
  {stage:"writer",model:"gpt-4.1-mini-2025-04-14",inputTokens:1200,outputTokens:700,responseId:"chatcmpl_writer_stage_001"},
  {stage:"editor",model:"gpt-4.1-mini-2025-04-14",inputTokens:1700,outputTokens:800,responseId:"chatcmpl_editor_stage_001"}
];
const rates={"openai-chat-completions/gpt-4.1-mini-2025-04-14":{
  inputUsdPerMillion:0.4,outputUsdPerMillion:1.6,source:"Offline public rate scenario; not provider invoice"
}};
const scenarios:ScenarioAssumptions={
  rates,unobservedCallReserveCents:25,unmeteredBlogAllowanceCentsPerJob:50,
  externalResearchCents:0,infrastructureCents:0,supportCents:0,workflowLicenseCents:0,
  processingRate:0.029,revenueShareRate:0
};

async function withShop(fn:(shop:string)=>Promise<void>){
  const shop="lifecycle-"+randomUUID()+".myshopify.com";
  await db.storeConfig.create({data:{shop,blogId:"gid://shopify/Blog/1"}});
  await db.session.create({data:{
    id:"offline-"+randomUUID(),shop,state:"offline-staging",accessToken:"synthetic",
    scope:"read_products,write_content",isOnline:false
  }});
  try{await fn(shop);}finally{await eraseMerchantData(shop);}
}
async function localN8nStub(
  ack:(shop:string,jobId:string)=>Record<string,unknown>,
  callback:(url:string,getCount:()=>number)=>Promise<void>
){
  let posts=0;
  const server=createServer(async(req,res)=>{
    posts++;
    try{
      assert.equal(req.method,"POST");
      assert.equal(req.headers["x-agent-key"],"synthetic-outbound-secret");
      const chunks:Buffer[]=[];
      for await(const part of req)chunks.push(Buffer.from(part));
      const body=JSON.parse(Buffer.concat(chunks).toString("utf8"));
      res.writeHead(202,{"Content-Type":"application/json"});
      res.end(JSON.stringify(ack(body.shop,body.jobId)));
    }catch{
      res.writeHead(500);res.end();
    }
  });
  server.listen(0,"127.0.0.1");
  await once(server,"listening");
  const address=server.address();
  if(!address||typeof address==="string")throw new Error("Missing loopback address");
  try{await callback("http://127.0.0.1:"+address.port+"/fake-n8n",()=>posts);}
  finally{await new Promise<void>((resolve,reject)=>server.close(e=>e?reject(e):resolve()));}
}
function completeRequest(shop:string,jobId:string,token:string){
  return new Request("http://localhost/api/agent/complete",{
    method:"POST",headers:{"Content-Type":"application/json","X-Agent-Key":token},
    body:JSON.stringify({shop,jobId,article,usage:receipts})
  });
}
test("offline staging: budget -> authenticated n8n 202 -> job callback -> immutable usage -> finance estimate",async()=>{
  // Test-only key; no external model or Shopify request is made.
  const previous=process.env.ARTICLE_CALLBACK_SIGNING_KEY;
  process.env.ARTICLE_CALLBACK_SIGNING_KEY=Buffer.alloc(32,21).toString("base64");
  try{
    await withShop(async shop=>{
      await db.$transaction(tx=>setBlogBudgetPolicy(tx,shop,50,25,true));
      const j=await createCreditedJob(shop,"Synthetic article");
      await claimQueuedDispatch(shop,j.id,undefined,at,env);
      await localN8nStub((name,jobId)=>({accepted:true,shop:name,jobId}),
        async(url,count)=>{
          await deliverClaimedN8nJob({shop,jobId:j.id,url,secret:"synthetic-outbound-secret",
            body:{shop,jobId:j.id,topic:"Synthetic article"}});
          assert.equal(count(),1);
        });
      assert.equal((await db.contentJob.findUniqueOrThrow({where:{id:j.id}})).status,"running");
      const token=createArticleCallbackToken(shop,j.id);
      const rejected=await articleCallbackAction({request:completeRequest(shop,j.id,
        createArticleCallbackToken(shop,"wrong-job"))} as any);
      assert.equal(rejected.status,401);
      assert.equal(await db.blogGenerationUsage.count({where:{shop}}),0);
      const accepted=await articleCallbackAction({request:completeRequest(shop,j.id,token)} as any);
      assert.equal(accepted.status,200);
      const retry=await articleCallbackAction({request:completeRequest(shop,j.id,token)} as any);
      assert.equal(retry.status,200);
      assert.equal(await db.articleDraft.count({where:{shop}}),1);
      assert.equal(await db.blogGenerationUsage.count({where:{shop}}),2);
      const exposure=await loadBudgetExposure(shop,month);
      assert.equal(exposure.policyEnabled,true);
      assert.equal(exposure.heldCents,25);
      assert.equal(exposure.heldJobCount,1);
      assert.equal(exposure.currentHeadroomCents,25);
      const observed=await loadObservedUsage(shop,month);
      assert.equal(observed.generationJobs,1);
      assert.equal(observed.completeBlogJobs,1);
      assert.equal(observed.blogUsageReceipts.length,2);
      const contribution=evaluatePlan("starter",observed,scenarios);
      assert.equal(contribution.incompleteBlogJobs,0);
      assert.equal(contribution.observedUnpricedCalls,0);
      assert.equal(contribution.unknownCallReserveCents,0);
      assert.equal(contribution.modeledContributionCents,4756);
      assert.equal(contribution.canPresentAsActualProfit,false);
      // Uncertainty or successful callbacks must NOT release reserved spend.
      const second=await createCreditedJob(shop,"Second synthetic");
      await claimQueuedDispatch(shop,second.id,undefined,at,env);
      assert.equal((await loadBudgetExposure(shop,month)).currentHeadroomCents,0);
      const third=await createCreditedJob(shop,"Third synthetic");
      await assert.rejects(claimQueuedDispatch(shop,third.id,undefined,at,env),BlogBudgetBlockedError);
      assert.equal((await db.contentJob.findUniqueOrThrow({where:{id:third.id}})).status,"queued");
      assert.equal((await loadBudgetExposure(shop,month)).heldJobCount,2);
    });
  }finally{
    if(previous===undefined)delete process.env.ARTICLE_CALLBACK_SIGNING_KEY;
    else process.env.ARTICLE_CALLBACK_SIGNING_KEY=previous;
  }
});
test("offline staging: ambiguous n8n acknowledgment preserves reservation and late callback is safe",async()=>{
  await withShop(async shop=>{
    await db.$transaction(tx=>setBlogBudgetPolicy(tx,shop,20,20,true));
    const j=await createCreditedJob(shop,"Ambiguous outcome");
    await claimQueuedDispatch(shop,j.id,undefined,at,env);
    await localN8nStub((name,_jobId)=>({accepted:true,shop:name,jobId:"incorrect"}),
      async(url,count)=>{
        await assert.rejects(deliverClaimedN8nJob({
          shop,jobId:j.id,url,secret:"synthetic-outbound-secret",
          body:{shop,jobId:j.id,topic:"Ambiguous outcome"}
        }),UncertainDispatchError);
        assert.equal(count(),1);
      });
    assert.equal((await db.contentJob.findUniqueOrThrow({where:{id:j.id}})).status,
      "dispatch_uncertain");
    assert.equal((await loadBudgetExposure(shop,month)).heldCents,20);
    const next=await createCreditedJob(shop,"Blocked due to exposure");
    await assert.rejects(claimQueuedDispatch(shop,next.id,undefined,at,env),
      BlogBudgetBlockedError);
    assert.equal((await db.blogBudgetClaim.count({where:{shop}})),1);
  });
});
test("tampered monthly exposure counter fails closed rather than reporting artificial headroom",async()=>{
  await withShop(async shop=>{
    await db.$transaction(tx=>setBlogBudgetPolicy(tx,shop,100,25,true));
    const j=await createCreditedJob(shop,"Corruption audit");
    await claimQueuedDispatch(shop,j.id,undefined,at,env);
    await db.blogBudgetMonth.update({where:{shop_month:{shop,month}},
      data:{committedCents:1}});
    await assert.rejects(loadBudgetExposure(shop,month),/reconciliation failed/);
  });
});
