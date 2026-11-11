import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import db from "../app/db.server";
import {hashOpenAiResponseId} from "../app/lib/blog-usage";
import {loadBlogUsageForCohort} from "../app/lib/provider-usage-reconciliation.server";
import {reconcileBlogProviderUsage} from "../app/lib/provider-usage-reconciliation";

test("provider usage cohort is exact-shop and original UTC job month, including late receipts",async()=>{
  const shop="audit-"+randomUUID()+".myshopify.com";
  const other="audit-"+randomUUID()+".myshopify.com";
  const id="chatcmpl_audit_writer_202611_001";
  await db.storeConfig.createMany({data:[{shop},{shop:other}]});
  try{
    const [own,foreign,old]=await Promise.all([
      db.contentJob.create({data:{shop,topic:"Own",createdAt:new Date("2026-11-05T12:00:00Z")}}),
      db.contentJob.create({data:{shop:other,topic:"Foreign",createdAt:new Date("2026-11-05T12:00:00Z")}}),
      db.contentJob.create({data:{shop,topic:"Old",createdAt:new Date("2026-10-30T12:00:00Z")}})
    ]);
    await db.blogGenerationUsage.createMany({data:[
      {shop,jobId:own.id,stage:"writer",model:"gpt-4.1-mini",
        inputTokens:500,outputTokens:100,responseIdHash:hashOpenAiResponseId(id),
        reportedAt:new Date("2026-12-01T10:00:00Z")},
      {shop:other,jobId:foreign.id,stage:"writer",model:"gpt-4.1-mini",
        inputTokens:900000,outputTokens:100,
        responseIdHash:hashOpenAiResponseId("chatcmpl_other_tenant_001")},
      {shop,jobId:old.id,stage:"writer",model:"gpt-4.1-mini",
        inputTokens:700,outputTokens:100,
        responseIdHash:hashOpenAiResponseId("chatcmpl_previous_month_001")}
    ]});
    const rows=await loadBlogUsageForCohort(shop,"2026-11");
    assert.equal(rows.length,1);
    assert.equal(rows[0].jobId,own.id);
    assert.equal(rows[0].inputTokens,500);
    assert.equal(rows[0].responseIdHash,hashOpenAiResponseId(id));
    const result=reconcileBlogProviderUsage(shop,"2026-11",rows,{
      schemaVersion:1,provider:"openai-chat-completions",period:"2026-11",
      accountScope:"shared",exportDescription:"Synthetic operator local audit input",
      records:[{responseId:id,model:"gpt-4.1-mini",inputTokens:500,
        outputTokens:100,createdAt:"2026-11-05T12:00:02Z"}]
    });
    assert.equal(result.exactlyMatchedCount,1);
    assert.equal(result.merchantBilledCents,null);
    assert.equal((await loadBlogUsageForCohort(other,"2026-11")).length,1);
    assert.equal((await loadBlogUsageForCohort(shop,"2026-10")).length,1);
    await assert.rejects(loadBlogUsageForCohort("shop.attacker.org","2026-11"),/Exact tenant/);
    await assert.rejects(loadBlogUsageForCohort(shop,"2026-13"),/Exact tenant/);
  }finally{
    for(const s of [shop,other]){
      await db.blogGenerationUsage.deleteMany({where:{shop:s}});
      await db.articleDraft.deleteMany({where:{shop:s}});
      await db.contentJob.deleteMany({where:{shop:s}});
      await db.storeConfig.deleteMany({where:{shop:s}});
    }
  }
});
