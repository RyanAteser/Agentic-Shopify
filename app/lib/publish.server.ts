import db from "../db.server";

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
    if(active.count!==1)return false;
    const review=await tx.editorialReview.findUnique({
      where:{shop_draftId:{shop,draftId}},select:{decision:true}
    });
    if(review?.decision!=="usable")return false;
    const claim=await tx.articleDraft.updateMany({
      where:{id:draftId,shop,status:"ready",seoScore:{gte:70}},
      data:{status:"publishing"}
    });
    return claim.count===1;
  });
  if(!claimed)return {ok:false,message:"Record a usable editorial review before publishing; the draft must still be ready and unpublished."};
  try{
    const [draft,config]=await Promise.all([
      db.articleDraft.findFirstOrThrow({where:{id:draftId,shop}}),
      db.storeConfig.findUniqueOrThrow({where:{shop}})
    ]);
    if(!config.blogId)throw new Error("No destination blog configured");
    const response=await admin.graphql(
      `#graphql mutation ManagerPublishArticle($article:ArticleCreateInput!) {
        articleCreate(article:$article) { article { id title } userErrors { field message } }
      }`,
      {variables:{article:{
        blogId:config.blogId,title:draft.title,body:draft.body,summary:draft.summary,
        author:{name:config.authorName},
        tags:draft.tags.split(",").map(t=>t.trim()).filter(Boolean),
        isPublished:true
      }}}
    );
    const result=await response.json();
    const errors=[...(result.errors||[]),...(result.data?.articleCreate?.userErrors||[])];
    const article=result.data?.articleCreate?.article;
    if(errors.length||!article?.id)throw new Error(errors.map((e:{message:string})=>e.message).join("; ")||"Shopify returned no article");
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
