import {test} from "node:test";
import assert from "node:assert/strict";
import {randomUUID} from "node:crypto";
import db from "../app/db.server";
import {editorialEditDigest, saveMerchantDraftEdit} from "../app/lib/editorial-edit.server";
import {recordEditorialReview} from "../app/lib/editorial-review.server";
import {publishApprovedArticle} from "../app/lib/publish.server";

const original = {
  title: "How to choose the right product for your needs",
  summary: "Practical guidance for comparing product features, care requirements and suitability before choosing what to purchase.",
  body: "<h2>Compare the details</h2><p>Review materials, dimensions, intended use and care instructions in the verified product listing. Compare these with your actual needs, and contact the merchant whenever a product claim is unclear or unsupported.</p>",
  tags: "Guide,Shopping",
  keyword: "product"
};

async function withDraft(fn:(shop:string,draftId:string)=>Promise<void>) {
  const shop = "edit-" + randomUUID() + ".myshopify.com";
  await db.storeConfig.create({data:{shop,blogId:"gid://shopify/Blog/1"}});
  try {
    const job = await db.contentJob.create({data:{shop,topic:"Choosing a product",status:"completed"}});
    const draft = await db.articleDraft.create({data:{
      shop,jobId:job.id,topic:job.topic,...original,status:"ready",seoScore:90
    }});
    await fn(shop,draft.id);
  } finally {
    await db.editorialReview.deleteMany({where:{shop}});
    await db.articleDraft.deleteMany({where:{shop}});
    await db.contentJob.deleteMany({where:{shop}});
    await db.storeConfig.deleteMany({where:{shop}});
  }
}
async function snapshot(draftId:string) {
  return db.articleDraft.findUniqueOrThrow({where:{id:draftId}});
}
function edit(shop:string,draftId:string,digest:string,overrides:Record<string,unknown>={}) {
  return saveMerchantDraftEdit(shop,draftId,digest,{...original,...overrides});
}

test("merchant correction is sanitized, rescored, unpublished and requires renewed review",async()=>{
  await withDraft(async(shop,draftId)=>{
    assert.equal((await recordEditorialReview(shop,draftId,"usable",4)).ok,true);
    const version=editorialEditDigest(await snapshot(draftId));
    const correctedBody=original.body + '<p onclick="alert(1)">Verified sizing details: <a href="javascript:alert(1)">unsafe link</a> consult the product listing.</p><script>alert(1)</script>';
    const saved=await edit(shop,draftId,version,{
      title:"How to compare a product before buying", body:correctedBody,
      tags:"Guide,Product comparison"
    });
    assert.equal(saved.ok,true);
    const draft=await snapshot(draftId);
    assert.equal(draft.status,"ready");
    assert.equal(draft.shopifyArticleId,null);
    assert.equal(draft.title,"How to compare a product before buying");
    assert.doesNotMatch(draft.body,/<script|onclick|javascript:/i);
    assert.match(draft.body,/Verified sizing details/);
    assert.ok(draft.seoScore>=70);
    const review=await db.editorialReview.findUniqueOrThrow({where:{shop_draftId:{shop,draftId}}});
    assert.equal(review.contentDigest,"");
    let published=0;
    const admin={graphql:async()=>{published++;throw Error("must not publish");}};
    assert.equal((await publishApprovedArticle(shop,draftId,admin)).ok,false);
    assert.equal(published,0);
    assert.equal((await recordEditorialReview(shop,draftId,"usable",5)).ok,true);
    assert.notEqual((await db.editorialReview.findUniqueOrThrow({where:{shop_draftId:{shop,draftId}}})).contentDigest,"");
    assert.equal(await db.editorialReview.count({where:{shop,draftId}}),1);
  });
});

test("stale browser form cannot overwrite a newer merchant correction",async()=>{
  await withDraft(async(shop,draftId)=>{
    const version=editorialEditDigest(await snapshot(draftId));
    assert.equal((await edit(shop,draftId,version,{summary:original.summary+" Updated."})).ok,true);
    const stale=await edit(shop,draftId,version,{title:"A stale competing edit"});
    assert.equal(stale.ok,false);
    assert.match(stale.message,/changed since/i);
    assert.equal((await snapshot(draftId)).title,original.title);
    assert.match((await snapshot(draftId)).summary,/Updated/);
  });
});

test("cross-merchant edits and edits after redaction are blocked",async()=>{
  await withDraft(async(shop,draftId)=>{
    const version=editorialEditDigest(await snapshot(draftId));
    const other="edit-other-"+randomUUID()+".myshopify.com";
    await db.storeConfig.create({data:{shop:other}});
    try {
      assert.equal((await edit(other,draftId,version,{title:"Wrong merchant"})).ok,false);
      assert.equal((await snapshot(draftId)).title,original.title);
      await db.storeConfig.delete({where:{shop}});
      assert.equal((await edit(shop,draftId,version,{title:"After uninstall"})).ok,false);
      assert.equal((await snapshot(draftId)).title,original.title);
    } finally {
      await db.storeConfig.deleteMany({where:{shop:other}});
    }
  });
});

test("published, publishing, rejected and reconciliation drafts cannot be edited",async()=>{
  for(const status of ["published","publishing","rejected","needs_reconciliation"]){
    await withDraft(async(shop,draftId)=>{
      const version=editorialEditDigest(await snapshot(draftId));
      await db.articleDraft.update({where:{id:draftId},data:{status}});
      const result=await edit(shop,draftId,version,{title:"Attempt to change locked article"});
      assert.equal(result.ok,false,status);
      assert.equal((await snapshot(draftId)).status,status);
    });
  }
});

test("unchanged save preserves existing approval; keyword-only edit invalidates it",async()=>{
  await withDraft(async(shop,draftId)=>{
    assert.equal((await recordEditorialReview(shop,draftId,"usable",3)).ok,true);
    const version=editorialEditDigest(await snapshot(draftId));
    const reviewBefore=await db.editorialReview.findUniqueOrThrow({where:{shop_draftId:{shop,draftId}}});
    assert.match((await edit(shop,draftId,version)).message,/No changes/i);
    assert.equal((await db.editorialReview.findUniqueOrThrow({where:{shop_draftId:{shop,draftId}}})).contentDigest,
      reviewBefore.contentDigest);
    assert.equal((await edit(shop,draftId,version,{keyword:"different"})).ok,true);
    assert.equal((await db.editorialReview.findUniqueOrThrow({where:{shop_draftId:{shop,draftId}}})).contentDigest,"");
    assert.equal((await snapshot(draftId)).status,"ready");
  });
});

test("weak edits require corrections and invalid or oversized edits never mutate a draft",async()=>{
  await withDraft(async(shop,draftId)=>{
    const version=editorialEditDigest(await snapshot(draftId));
    for(const changes of [
      {title:""},
      {body:"<script>alert(1)</script>"},
      {body:"x".repeat(60001)},
      {body:"界".repeat(21000)}, // 63 KB UTF-8 despite fewer than 60,000 JS characters
      {tags:"one,two,three,four,five,six,seven,eight,nine"},
      {summary:"x".repeat(501)}
    ]){
      const result=await edit(shop,draftId,version,changes);
      assert.equal(result.ok,false);
      assert.equal(editorialEditDigest(await snapshot(draftId)),version);
    }
    const weak=await edit(shop,draftId,version,{title:"Short",summary:"Too short"});
    assert.equal(weak.ok,true);
    assert.equal((await snapshot(draftId)).status,"needs_review");
    assert.equal((await recordEditorialReview(shop,draftId,"usable",3)).ok,false);
  });
});
