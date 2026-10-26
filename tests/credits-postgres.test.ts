import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import db from "../app/db.server";
import {createCreditedJob} from "../app/lib/credits.server";

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
