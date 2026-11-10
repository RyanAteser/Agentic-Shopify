import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import db from "../app/db.server";
import {claimQueuedDispatch} from "../app/lib/dispatch-claim.server";
import {setBlogBudgetPolicy} from "../app/lib/blog-budget.server";
import {eraseMerchantData} from "../app/lib/merchant-redaction.server";

test("PostgreSQL simultaneous dispatch claims cannot oversubscribe a monthly merchant budget",{
  skip:!process.env.DATABASE_URL
},async()=>{
  const shop="pg-budget-"+randomUUID()+".myshopify.com";
  await db.storeConfig.create({data:{shop,blogId:"gid://shopify/Blog/1"}});
  await db.session.create({data:{id:"offline-"+randomUUID(),shop,state:"synthetic",
    accessToken:"offline-test",isOnline:false,scope:"write_content,read_products"}});
  try{
    await db.$transaction(tx=>setBlogBudgetPolicy(tx,shop,40,20,true));
    const jobs=await Promise.all(Array.from({length:6},(_,i)=>
      db.contentJob.create({data:{shop,topic:"Concurrent budget "+i}})));
    const at=new Date("2026-11-10T12:00:00Z");
    const results=await Promise.allSettled(jobs.map(j=>claimQueuedDispatch(shop,j.id,undefined,at,
      {BLOG_BUDGET_ENFORCE:"true"})));
    assert.equal(results.filter(x=>x.status==="fulfilled").length,2);
    const month=await db.blogBudgetMonth.findUniqueOrThrow({
      where:{shop_month:{shop,month:"2026-11"}}
    });
    assert.equal(month.committedCents,40);
    assert.equal(await db.blogBudgetClaim.count({where:{shop}}),2);
    assert.equal(await db.contentJob.count({where:{shop,status:"running"}}),2);
    assert.equal(await db.contentJob.count({where:{shop,status:"queued"}}),4);
  }finally{await eraseMerchantData(shop);}
});
