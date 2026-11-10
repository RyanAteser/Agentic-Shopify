import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import db from "../app/db.server";
import {parseBlogUsage,InvalidBlogUsageError} from "../app/lib/blog-usage";
import {persistArticleCallback} from "../app/lib/article-callback.server";
import {eraseMerchantData} from "../app/lib/merchant-redaction.server";

const article={
  title:"Choosing the right product for your needs",
  summary:"A useful approach to comparing product suitability.",
  keyword:"products",tags:["Care"],
  body:"<h2>Product evaluation</h2><p>Choose a product based on its materials, stated care needs, size, and the manufacturer instructions. Check documented product claims and contact the merchant before relying on anything unclear.</p>"
};
const usage=[
  {stage:"writer",model:"gpt-4.1-mini-2025-04-14",inputTokens:2500,outputTokens:800,responseId:"chatcmpl_writer_12345"},
  {stage:"editor",model:"gpt-4.1-mini-2025-04-14",inputTokens:2800,outputTokens:900,responseId:"chatcmpl_editor_12345"}
];
test("worker usage validator preserves real token counts without persisting provider request ids",()=>{
  const parsed=parseBlogUsage(usage);
  assert.equal(parsed.length,2);
  assert.equal(parsed[0].inputTokens,2500);
  assert.match(parsed[0].responseIdHash!,/^[a-f0-9]{64}$/);
  assert.equal(parsed[0].responseIdHash!.includes("chatcmpl"),false);
  assert.deepEqual(parseBlogUsage(undefined),[]);
  assert.throws(()=>parseBlogUsage([...usage,usage[0]]),InvalidBlogUsageError);
  assert.throws(()=>parseBlogUsage([usage[0],usage[0]]),InvalidBlogUsageError);
  assert.throws(()=>parseBlogUsage([{...usage[0],model:"unapproved-model"}]),InvalidBlogUsageError);
  assert.throws(()=>parseBlogUsage([{...usage[0],outputTokens:0}]),InvalidBlogUsageError);
  assert.throws(()=>parseBlogUsage([{...usage[0],outputTokens:-1}]),InvalidBlogUsageError);
  assert.throws(()=>parseBlogUsage([{...usage[0],responseId:"bad token\n"}]),InvalidBlogUsageError);
});
test("job-scoped callback persists two usage receipts exactly once, and privacy erases them",async()=>{
  const shop="usage-"+randomUUID()+".myshopify.com";
  const foreign="usage-"+randomUUID()+".myshopify.com";
  await db.storeConfig.createMany({data:[{shop},{shop:foreign}]});
  const job=await db.contentJob.create({data:{shop,topic:"Product care",status:"running"}});
  try{
    await assert.rejects(persistArticleCallback(foreign,job.id,article,usage));
    assert.equal(await db.blogGenerationUsage.count({where:{shop:foreign}}),0);
    const first=await persistArticleCallback(shop,job.id,article,usage);
    assert.ok(first.draftId);
    const receipts=await db.blogGenerationUsage.findMany({where:{shop,jobId:job.id}});
    assert.equal(receipts.length,2);
    assert.deepEqual(receipts.map(x=>x.stage).sort(),["editor","writer"]);
    const replay=await persistArticleCallback(shop,job.id,article,[
      {...usage[0],inputTokens:999999},usage[1]
    ]);
    assert.deepEqual(replay,first);
    assert.equal((await db.blogGenerationUsage.findFirstOrThrow({
      where:{shop,jobId:job.id,stage:"writer"}
    })).inputTokens,2500);
    assert.equal(await db.blogGenerationUsage.count({where:{shop}}),2);
    await eraseMerchantData(shop);
    assert.equal(await db.blogGenerationUsage.count({where:{shop}}),0);
    assert.equal(await db.articleDraft.count({where:{shop}}),0);
  }finally{
    await db.blogGenerationUsage.deleteMany({where:{shop:{in:[shop,foreign]}}});
    await db.editorialReview.deleteMany({where:{shop:{in:[shop,foreign]}}});
    await db.articleDraft.deleteMany({where:{shop:{in:[shop,foreign]}}});
    await db.contentJob.deleteMany({where:{shop:{in:[shop,foreign]}}});
    await db.storeConfig.deleteMany({where:{shop:{in:[shop,foreign]}}});
  }
});
test("bad callback usage cannot partially finish a valid running job",async()=>{
  const shop="usage-invalid-"+randomUUID()+".myshopify.com";
  await db.storeConfig.create({data:{shop}});
  const job=await db.contentJob.create({data:{shop,topic:"Product care",status:"running"}});
  try{
    await assert.rejects(persistArticleCallback(shop,job.id,article,[{
      ...usage[0],inputTokens:-1
    }]),/Invalid blog model usage report/);
    assert.equal(await db.blogGenerationUsage.count({where:{shop}}),0);
    assert.equal(await db.articleDraft.count({where:{shop}}),0);
    assert.equal((await db.contentJob.findUniqueOrThrow({where:{id:job.id}})).status,"running");
  }finally{
    await db.blogGenerationUsage.deleteMany({where:{shop}});
    await db.articleDraft.deleteMany({where:{shop}});
    await db.contentJob.deleteMany({where:{shop}});
    await db.storeConfig.deleteMany({where:{shop}});
  }
});
