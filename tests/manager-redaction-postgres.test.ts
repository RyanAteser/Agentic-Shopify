import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import db from "../app/db.server";
import { syncManagerTasks, logStoreAction } from "../app/lib/manager.server";
import { eraseMerchantData } from "../app/lib/merchant-redaction.server";

const catalog=[{
  id:"gid://shopify/Product/123",title:"Product care",description:"",
  url:"https://example.test/products/care",seo:null
}];

/**
 * PostgreSQL-only integration test: races recommendation creation and audit
 * writes against a verified merchant redaction. The store row is the first
 * lock in all three operations. No live Shopify API is invoked.
 */
test("PostgreSQL manager sync, audit and redaction cannot resurrect merchant records",{
  skip:!process.env.DATABASE_URL,
},async()=>{
  const control="manager-control-"+randomUUID()+".myshopify.com";
  await db.storeConfig.create({data:{shop:control}});
  await syncManagerTasks(control,catalog);
  await logStoreAction(control,null,"manager.sync","applied","control");
  try{
    for(let round=0;round<5;round++){
      const shop="manager-race-"+randomUUID()+".myshopify.com";
      await db.storeConfig.create({data:{shop}});
      const results=await Promise.allSettled([
        syncManagerTasks(shop,catalog),
        logStoreAction(shop,null,"manager.sync","applied","race"),
        eraseMerchantData(shop),
        syncManagerTasks(shop,catalog),
      ]);
      for(const [index,result] of results.entries()){
        assert.equal(result.status,"fulfilled",`race operation ${index} should complete`);
      }
      assert.equal(await db.storeConfig.count({where:{shop}}),0);
      assert.equal(await db.storeRecommendation.count({where:{shop}}),0);
      assert.equal(await db.storeActivity.count({where:{shop}}),0);
      assert.equal(await syncManagerTasks(shop,catalog),0);
      await logStoreAction(shop,null,"manager.sync","applied","late");
      assert.equal(await db.storeRecommendation.count({where:{shop}}),0);
      assert.equal(await db.storeActivity.count({where:{shop}}),0);
      await eraseMerchantData(shop);
    }
    assert.equal(await db.storeConfig.count({where:{shop:control}}),1);
    assert.ok(await db.storeRecommendation.count({where:{shop:control}})>0);
    assert.equal(await db.storeActivity.count({where:{shop:control}}),1);
  }finally{
    await eraseMerchantData(control);
  }
});
