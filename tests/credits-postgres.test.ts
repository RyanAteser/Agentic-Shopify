import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import db from "../app/db.server";
import {createCreditedJob, failCreditedJob} from "../app/lib/credits.server";
import {persistArticleCallback, ArticleCallbackRejectedError} from "../app/lib/article-callback.server";
import {eraseMerchantData} from "../app/lib/merchant-redaction.server";

/** Runs only against the PostgreSQL CI service, not SQLite's single-writer dev DB. */
test("PostgreSQL concurrent free quota claims never overspend",{
  skip:!process.env.DATABASE_URL
},async()=>{
  const shop="pg-"+randomUUID()+".myshopify.com";
  await db.storeConfig.create({data:{shop,blogId:"gid://shopify/Blog/1"}});
  try{
    const results=await Promise.allSettled(Array.from({length:6},(_,i)=>
      createCreditedJob(shop,"Concurrent eligible draft "+i)));
    const successes=results.filter(x=>x.status==="fulfilled");
    assert.equal(successes.length,3);
    const [config,jobCount]=await Promise.all([
      db.storeConfig.findUniqueOrThrow({where:{shop}}),
      db.contentJob.count({where:{shop}})
    ]);
    assert.equal(config.freeDraftsUsed,3);
    assert.equal(jobCount,3);
  }finally{
    await db.contentJob.deleteMany({where:{shop}});
    await db.storeConfig.deleteMany({where:{shop}});
  }
});

const sampleArticle={
  title:"A practical product selection guide",
  summary:"Compare materials, fit, care and intended use before buying a product.",
  keyword:"product",
  tags:["Guide"],
  body:"<h2>Choose carefully</h2><p>Check materials, fit, care instructions and intended use against your needs. Review the merchant's product listing and ask for clarification about claims before buying. Consider whether each product is appropriate for the intended purpose.</p>"
};

/**
 * Both callback persistence and credit refunds update StoreConfig before
 * ContentJob. PostgreSQL must serialize either winning order without deadlock,
 * partial draft persistence, or double refund.
 */
test("PostgreSQL callback versus definitive refund preserves one outcome",{
  skip:!process.env.DATABASE_URL
},async()=>{
  for(let round=0;round<6;round++){
    const shop="refund-race-"+randomUUID()+".myshopify.com";
    await db.storeConfig.create({data:{shop}});
    try{
      const job=await createCreditedJob(shop,"Guide for refund concurrency");
      await db.contentJob.update({where:{id:job.id},data:{status:"running"}});
      const [callback,refund]=await Promise.allSettled([
        persistArticleCallback(shop,job.id,sampleArticle),
        failCreditedJob(shop,job.id,"Definitive n8n rejection")
      ]);
      assert.equal(refund.status,"fulfilled","refund must not deadlock");
      if(refund.status!=="fulfilled")continue;
      const stored=await db.contentJob.findUniqueOrThrow({where:{id:job.id}});
      const drafts=await db.articleDraft.count({where:{jobId:job.id}});
      const config=await db.storeConfig.findUniqueOrThrow({where:{shop}});
      if(refund.value){
        assert.equal(callback.status,"rejected");
        if(callback.status==="rejected"){
          assert.ok(callback.reason instanceof ArticleCallbackRejectedError);
          assert.equal(callback.reason.status,409);
        }
        assert.equal(stored.status,"failed");
        assert.equal(drafts,0);
        assert.equal(config.freeDraftsUsed,0);
      }else{
        assert.equal(callback.status,"fulfilled","completed callback prevents refund");
        assert.equal(stored.status,"completed");
        assert.equal(drafts,1);
        assert.equal(config.freeDraftsUsed,1);
      }
      assert.equal(await failCreditedJob(shop,job.id,"duplicate refund"),false);
    }finally{
      await eraseMerchantData(shop);
    }
  }
});

test("PostgreSQL merchant redaction and credit refund cannot resurrect a store",{
  skip:!process.env.DATABASE_URL
},async()=>{
  for(let round=0;round<4;round++){
    const shop="refund-redact-"+randomUUID()+".myshopify.com";
    await db.storeConfig.create({data:{shop}});
    const job=await createCreditedJob(shop,"Guide before uninstall");
    const [refund,redaction]=await Promise.allSettled([
      failCreditedJob(shop,job.id,"Definitive rejection"),
      eraseMerchantData(shop)
    ]);
    assert.equal(refund.status,"fulfilled","refund must not deadlock with redaction");
    assert.equal(redaction.status,"fulfilled","redaction must complete");
    assert.equal(await db.storeConfig.count({where:{shop}}),0);
    assert.equal(await db.contentJob.count({where:{shop}}),0);
    assert.equal(await db.articleDraft.count({where:{shop}}),0);
    assert.equal(await failCreditedJob(shop,job.id,"late retry"),false);
  }
});
