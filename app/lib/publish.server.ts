import db from "../db.server";
import { toSafeShopifySummaryHtml } from "./article-summary";
import { hasCurrentUsableReview } from "./editorial-review-integrity";

type Admin = {graphql: (...args:any[])=>Promise<any>};

/**
 * The only article publisher; called on a verified merchant POST, never by n8n.
 * Conditional claim ensures concurrent approval clicks cannot publish twice.
 * On an uncertain Shopify response, manual reconciliation is required.
 */
export async function publishApprovedArticle(shop:string,draftId:string,admin:Admin) {
  // A structure score is not evidence that a person checked factual claims.
  // Require an immutable, shop-scoped usable editorial review before the
  // irreversible Shopify mutation. Lock StoreConfig first to match review,
  // callback and merchant-redaction transaction ordering.
  const claimed=await db.$transaction(async tx=>{
    const active=await tx.storeConfig.updateMany({
      where:{shop},data:{updatedAt:new Date()}
    });
    if(active.count!==1)return null;
    // Capture the selected destination and exact reviewed content at claim
    // time. A missing blog is a local validation error, not an uncertain
    // Shopify mutation, so leave the draft ready for correction.
    const config=await tx.storeConfig.findUnique({
      where:{shop},select:{blogId:true,authorName:true}
    });
    if(!config?.blogId)return null;
    const review=await tx.editorialReview.findUnique({
      where:{shop_draftId:{shop,draftId}},select:{decision:true,contentDigest:true}
    });
    const draft=await tx.articleDraft.findFirst({
      where:{id:draftId,shop,status:"ready",seoScore:{gte:70}},
      select:{title:true,body:true,summary:true,tags:true}
    });
    if(!draft || !hasCurrentUsableReview(review,draft,config))return null;
    // The conditional claim rejects a concurrent content edit between the
    // digest comparison and status transition, even from an external writer.
    const claim=await tx.articleDraft.updateMany({
      where:{id:draftId,shop,status:"ready",seoScore:{gte:70},
        title:draft.title,body:draft.body,summary:draft.summary,tags:draft.tags},
      data:{status:"publishing"}
    });
    return claim.count===1?{...draft,...config}:null;
  });
  if(!claimed)return {ok:false,message:"A connected destination blog, current usable editorial review and ready unpublished draft are required."};
  try{
    const response=await admin.graphql(
      `#graphql mutation ManagerPublishArticle($article:ArticleCreateInput!) {
        articleCreate(article:$article) { article { id title isPublished blog { id } } userErrors { field message } }
      }`,
      {variables:{article:{
        blogId:claimed.blogId,title:claimed.title,body:claimed.body,summary:toSafeShopifySummaryHtml(claimed.summary),
        author:{name:claimed.authorName},
        tags:claimed.tags.split(",").map(t=>t.trim()).filter(Boolean),
        isPublished:true
      }}}
    );
    const result=await response.json();
    const errors=[...(result.errors||[]),...(result.data?.articleCreate?.userErrors||[])];
    const article=result.data?.articleCreate?.article;
    // A successful HTTP/GraphQL response does not establish that the article
    // is visible in the intended blog. Fail closed and require reconciliation
    // if Shopify omits these fields or reports an unexpected destination.
    if(errors.length||typeof article?.id!=="string"||!article.id||
       article.isPublished!==true||article.blog?.id!==claimed.blogId) {
      throw new Error(errors.map((e:{message:string})=>e.message).join("; ")||
        "Shopify did not confirm a published article in the selected blog");
    }
    await db.articleDraft.update({where:{id:draftId},data:{
      status:"published",shopifyArticleId:article.id,publishedAt:new Date()
    }});
    return {ok:true,message:"Article published: "+article.title};
  }catch(e){
    // A request may have succeeded at Shopify even if its response/database write failed.
    // Do not retry automatically or blindly reset to ready.
    await db.articleDraft.updateMany({where:{id:draftId,shop,status:"publishing"},data:{status:"needs_reconciliation"}});
    console.error("Article publishing requires reconciliation",e);
    return {ok:false,message:"Publication could not be confirmed; check Shopify Articles before retrying."};
  }
}
