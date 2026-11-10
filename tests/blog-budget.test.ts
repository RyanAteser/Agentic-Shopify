import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import db from "../app/db.server";
import {claimQueuedDispatch,DispatchAlreadyClaimedError} from "../app/lib/dispatch-claim.server";
import {BlogBudgetBlockedError,generationMonthUTC,setBlogBudgetPolicy,validBlogBudget} from "../app/lib/blog-budget.server";
import {eraseMerchantData} from "../app/lib/merchant-redaction.server";

const env={BLOG_BUDGET_ENFORCE:"true"};
const t0=new Date("2026-11-10T12:00:00.000Z");
const t1=new Date("2026-12-01T00:00:00.000Z");
async function seeded(){
  const shop="budget-"+randomUUID()+".myshopify.com";
  const sessionId="offline-"+randomUUID();
  await db.storeConfig.create({data:{shop,blogId:"gid://shopify/Blog/1"}});
  await db.session.create({data:{id:sessionId,shop,state:"synthetic",accessToken:"offline-test",
    isOnline:false,scope:"write_content,read_products"}});
  return shop;
}
async function updatePolicy(shop:string,cap:number,reserve:number,enabled=true){
  await db.$transaction(tx=>setBlogBudgetPolicy(tx,shop,cap,reserve,enabled));
}
async function job(shop:string){
  return db.contentJob.create({data:{shop,topic:"Synthetic test only"}});
}
test("opt-in monthly allowance blocks before dispatch, serializes same-shop reservations, and survives uncertainty",async()=>{
  const shop=await seeded();
  try{
    const a=await job(shop),b=await job(shop),c=await job(shop);
    await assert.rejects(claimQueuedDispatch(shop,a.id,undefined,t0,env),BlogBudgetBlockedError);
    assert.equal((await db.contentJob.findUniqueOrThrow({where:{id:a.id}})).status,"queued");
    assert.equal(await db.blogBudgetClaim.count({where:{shop}}),0);
    await updatePolicy(shop,40,20,false);
    await assert.rejects(claimQueuedDispatch(shop,a.id,undefined,t0,env),BlogBudgetBlockedError);
    await updatePolicy(shop,40,20,true);
    await claimQueuedDispatch(shop,a.id,undefined,t0,env);
    await claimQueuedDispatch(shop,b.id,undefined,t0,env);
    await assert.rejects(claimQueuedDispatch(shop,c.id,undefined,t0,env),BlogBudgetBlockedError);
    await assert.rejects(claimQueuedDispatch(shop,a.id,undefined,t0,env),DispatchAlreadyClaimedError);
    const usage=await db.blogBudgetMonth.findUniqueOrThrow({where:{shop_month:{shop,month:"2026-11"}}});
    assert.equal(usage.committedCents,40);
    assert.deepEqual((await db.blogBudgetClaim.findMany({where:{shop},orderBy:{jobId:"asc"}}))
      .map(x=>x.reservedCents),[20,20]);
    assert.equal((await db.contentJob.findUniqueOrThrow({where:{id:c.id}})).status,"queued");
    // An unconfirmed n8n attempt must not free capacity just because we cannot
    // see a completion, and a later month may have an independent allowance.
    await db.contentJob.update({where:{id:a.id},data:{status:"dispatch_uncertain"}});
    assert.equal((await db.blogBudgetMonth.findUniqueOrThrow({
      where:{shop_month:{shop,month:"2026-11"}}
    })).committedCents,40);
    await claimQueuedDispatch(shop,c.id,undefined,t1,env);
    assert.equal((await db.blogBudgetMonth.findUniqueOrThrow({
      where:{shop_month:{shop,month:"2026-12"}}
    })).committedCents,20);
    // A lowered policy cannot retroactively refund reservations.
    await updatePolicy(shop,10,10,true);
    const extra=await job(shop);
    await assert.rejects(claimQueuedDispatch(shop,extra.id,undefined,t1,env),BlogBudgetBlockedError);
  }finally{
    await eraseMerchantData(shop);
    assert.equal(await db.blogBudgetMonth.count({where:{shop}}),0);
    assert.equal(await db.blogBudgetClaim.count({where:{shop}}),0);
    assert.equal(await db.blogBudgetPolicy.count({where:{shop}}),0);
  }
});
test("budget guard checks exact tenant, settings snapshot and malformed flag without consuming allowance",async()=>{
  const shop=await seeded(),other=await seeded();
  try{
    await updatePolicy(shop,30,15);
    const a=await job(shop),b=await job(other);
    await assert.rejects(claimQueuedDispatch(shop,a.id,undefined,t0,
      {BLOG_BUDGET_ENFORCE:"TrUe"}),BlogBudgetBlockedError);
    await assert.rejects(claimQueuedDispatch(shop,a.id,{
      blogId:"gid://shopify/Blog/WRONG",audience:"",brandVoice:"",
      seedTopics:"",authorName:"Editorial Team"
    },t0,env),DispatchAlreadyClaimedError);
    assert.equal(await db.blogBudgetClaim.count({where:{shop}}),0);
    await assert.rejects(claimQueuedDispatch(other,b.id,undefined,t0,env),BlogBudgetBlockedError);
    assert.equal(await db.blogBudgetClaim.count({where:{shop:other}}),0);
    // Without the opt-in flag, historical free trial dispatch semantics remain unchanged.
    await claimQueuedDispatch(other,b.id,undefined,t0,{});
    assert.equal(await db.blogBudgetClaim.count({where:{shop:other}}),0);
    assert.equal((await db.contentJob.findUniqueOrThrow({where:{id:b.id}})).status,"running");
    assert.throws(()=>validBlogBudget(100,101),BlogBudgetBlockedError);
    assert.throws(()=>validBlogBudget(100,-1),BlogBudgetBlockedError);
    assert.throws(()=>generationMonthUTC(new Date("nope")),BlogBudgetBlockedError);
  }finally{
    await eraseMerchantData(shop);
    await eraseMerchantData(other);
  }
});
test("budget cannot be provisioned for an absent installation",async()=>{
  const shop="missing-"+randomUUID()+".myshopify.com";
  await assert.rejects(db.$transaction(tx=>
    setBlogBudgetPolicy(tx,shop,100,20,true)),BlogBudgetBlockedError);
  assert.equal(await db.blogBudgetPolicy.count({where:{shop}}),0);
});
