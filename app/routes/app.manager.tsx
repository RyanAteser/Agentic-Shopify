import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, Link, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { readMerchantProductSample, syncManagerTasks, logStoreAction } from "../lib/manager.server";
import { publishApprovedArticle } from "../lib/publish.server";
import { canExecuteAction } from "../lib/action-policy";

const statuses=["pending","approved","applied","dismissed","resolved"] as const;

export const loader=async ({request}:LoaderFunctionArgs)=>{
  const {admin,session}=await authenticate.admin(request);
  const shop=session.shop;
  const {products,warning}=await readMerchantProductSample(admin);
  await syncManagerTasks(shop,products);
  const query=new URL(request.url).searchParams.get("status")||"pending";
  const filter=(statuses as readonly string[]).includes(query)?query:"pending";
  const [tasks,activity,counts]=await Promise.all([
    db.storeRecommendation.findMany({where:{shop,status:filter},orderBy:[{priority:"desc"},{createdAt:"desc"}],take:70}),
    db.storeActivity.findMany({where:{shop},orderBy:{createdAt:"desc"},take:30}),
    db.storeRecommendation.groupBy({by:["status"],where:{shop},_count:{_all:true}})
  ]);
  // Never fetch another shop's content based on a form value.
  const ids=tasks.filter(t=>t.kind==="blog_publish").map(t=>t.targetId);
  const articles=await db.articleDraft.findMany({
    where:{shop,id:{in:ids}},select:{id:true,body:true,summary:true,seoScore:true,title:true,reviewNotes:true,status:true}
  });
  return {shop,warning,filter,tasks,activity,counts,articles};
};

export const action=async ({request}:ActionFunctionArgs)=>{
  const {admin,session}=await authenticate.admin(request);
  const shop=session.shop;
  const actorId=String(session.onlineAccessInfo?.id ?? session.id);
  const form=await request.formData();
  const intent=String(form.get("intent")||"");
  const id=String(form.get("id")||"").slice(0,120);
  if(!["dismiss","approve","resolve","publish"].includes(intent)||!id) {
    return {ok:false,message:"Invalid request."};
  }
  const task=await db.storeRecommendation.findFirst({where:{id,shop}});
  if(!task)return {ok:false,message:"Task not found for this store."};
  try {
    if(intent==="publish"){
      if(task.kind!=="blog_publish"||task.agent!=="content"||task.status!=="pending") {
        return {ok:false,message:"This item is not an eligible article approval."};
      }
      // Server-side confirmation guard; frontend checkbox alone is insufficient.
      if(form.get("verified")!=="on")return {ok:false,message:"Review the article and confirm its accuracy first."};
      if(!canExecuteAction("content.article.publish",{humanApproved:true})) {
        return {ok:false,message:"Publishing forbidden by policy."};
      }
      const result=await publishApprovedArticle(shop,task.targetId,admin);
      if(result.ok){
        await db.storeRecommendation.updateMany({where:{id,shop,status:"pending"},data:{status:"applied",decidedAt:new Date()}});
      }
      await logStoreAction(shop,id,"article.publish",result.ok?"applied":"reconciliation_required",result.message,actorId).catch(error=>console.error("Activity recording failed",error));
      return result;
    }
    if(intent==="dismiss"){
      const result=await db.storeRecommendation.updateMany({where:{id,shop,status:{in:["pending","approved"]}},
        data:{status:"dismissed",decidedAt:new Date()}});
      if(!result.count)return {ok:false,message:"Already handled."};
      await logStoreAction(shop,id,"recommendation.dismiss","dismissed",task.title,actorId).catch(error=>console.error("Activity recording failed",error));
      return {ok:true,message:"Recommendation dismissed; no store content was changed."};
    }
    if(intent==="approve"){
      if(task.kind==="blog_publish")return {ok:false,message:"Use Publish with article review for this task."};
      const result=await db.storeRecommendation.updateMany({where:{id,shop,status:"pending"},
        data:{status:"approved",decidedAt:new Date()}});
      if(!result.count)return {ok:false,message:"Already handled."};
      await logStoreAction(shop,id,"recommendation.approve","approved",task.title,actorId).catch(error=>console.error("Activity recording failed",error));
      return {ok:true,message:"Recommendation accepted for manual follow-up. No store changes were made."};
    }
    const result=await db.storeRecommendation.updateMany({where:{id,shop,status:"approved"},
      data:{status:"resolved",decidedAt:new Date()}});
    if(!result.count)return {ok:false,message:"Only approved items can be marked completed."};
    await logStoreAction(shop,id,"recommendation.resolve","resolved",task.title,actorId).catch(error=>console.error("Activity recording failed",error));
    return {ok:true,message:"Marked completed. This confirms your review, not a verified ranking improvement."};
  }catch(err){
    console.error("Store manager action error",err);
    return {ok:false,message:"Action failed. Check the activity log and Shopify before retrying."};
  }
};

export default function StoreManager(){
  const {shop,warning,filter,tasks,activity,counts,articles}=useLoaderData<typeof loader>();
  const outcome=useActionData<typeof action>();
  const nav=useNavigation();
  const busy=nav.state!=="idle";
  const totals=Object.fromEntries(counts.map(x=>[x.status,x._count._all])) as Record<string,number>;
  const draftMap=new Map(articles.map(a=>[a.id,a]));
  return <s-page heading="Store Manager · Approval Inbox">
    <s-section heading="Your store, one team">
      <p>Connected merchant: <strong>{shop}</strong></p>
      <p><Link to="/app/team">Your AI Team</Link> · <Link to="/app/seo">SEO Intelligence</Link> · <Link to="/app">Blog Agent</Link></p>
      <p>This manager consolidates evidence-backed SEO findings, ranking changes, and editorial drafts. It cannot set prices, spend on ads, or edit products by itself.</p>
      {warning&&<p role="status">{warning}</p>}
      {outcome&&<p role="status"><strong>{outcome.ok?"Success":"Attention"}:</strong> {outcome.message}</p>}
    </s-section>
    <s-section heading="Task queue">
      <div style={{display:"flex",flexWrap:"wrap",gap:16,marginBottom:18}}>
        {statuses.map(s=><Link key={s} to={"/app/manager?status="+s} style={{
          fontWeight:filter===s?"bold":"normal",textDecoration:filter===s?"underline":"none"
        }}>{s.charAt(0).toUpperCase()+s.slice(1)} ({totals[s]??0})</Link>)}
      </div>
      {!tasks.length&&<p>No {filter} tasks. New content drafts and SEO findings will appear here after the corresponding connectors produce data.</p>}
      {tasks.map(task=>{
        const article=draftMap.get(task.targetId);
        const evidence=(()=>{try{return JSON.parse(task.evidence)}catch{return {}}})();
        return <article key={task.id} style={{border:"1px solid #ddd",borderRadius:12,padding:16,marginBottom:12}}>
          <div style={{display:"flex",alignItems:"center",gap:10,flexWrap:"wrap"}}>
            <strong>{task.title}</strong>
            <small>{task.agent.toUpperCase()} · Priority {task.priority}/100 · {task.status}</small>
          </div>
          <p>{task.rationale}</p>
          <details>
            <summary>Inspect evidence and context</summary>
            <p><small>Source: {evidence.source||"internal"}</small></p>
            {task.kind==="blog_publish" && article && <>
              <p><strong>Excerpt:</strong> {article.summary}</p>
              <div style={{maxHeight:350,overflow:"auto",padding:12,border:"1px solid #ddd"}}
                dangerouslySetInnerHTML={{__html:article.body}}/>
              <p style={{whiteSpace:"pre-wrap"}}>{article.reviewNotes}</p>
            </>}
            {typeof evidence.url==="string"&&evidence.url.startsWith("https://")&&
              <p><a href={evidence.url} target="_blank" rel="noopener noreferrer">View original page</a></p>}
            <p>Added: {new Date(task.createdAt).toLocaleString()}</p>
          </details>
          {task.status==="pending"&&<div style={{display:"flex",gap:10,flexWrap:"wrap",alignItems:"center",marginTop:10}}>
            {task.kind==="blog_publish" ? <Form method="post" onSubmit={e=>{
              if(!window.confirm("Publish this reviewed article to the Shopify blog now?"))e.preventDefault();
            }}>
              <input type="hidden" name="id" value={task.id}/>
              <input type="hidden" name="intent" value="publish"/>
              <label style={{marginRight:8}}><input type="checkbox" name="verified" required/> I verified claims, sources and brand fit</label>
              <button type="submit" disabled={busy||article?.status!=="ready"}>Approve & Publish</button>
            </Form>:<>
              <Form method="post">
                <input type="hidden" name="id" value={task.id}/>
                <input type="hidden" name="intent" value="approve"/>
                <button type="submit" disabled={busy}>Accept recommendation</button>
              </Form>
              {task.agent==="seo"&&<Link to="/app/seo">Review in SEO workspace</Link>}
              {task.kind==="blog_review"&&<Link to="/app">Open draft editor</Link>}
            </>}
            <Form method="post">
              <input type="hidden" name="id" value={task.id}/>
              <input type="hidden" name="intent" value="dismiss"/>
              <button type="submit" disabled={busy}>Dismiss</button>
            </Form>
          </div>}
          {task.status==="approved"&&<div style={{marginTop:10}}>
            <p>Accepted for manual follow-up. Nothing has been modified in Shopify.</p>
            <Form method="post">
              <input type="hidden" name="id" value={task.id}/>
              <input type="hidden" name="intent" value="resolve"/>
              <button type="submit" disabled={busy}>Mark my follow-up complete</button>
            </Form>
          </div>}
        </article>;
      })}
    </s-section>
    <s-section heading="Recent decisions · Audit trail">
      {!activity.length&&<p>No approval decisions recorded yet.</p>}
      <ul>{activity.map(item=><li key={item.id}>
        <strong>{item.action}</strong> · {item.outcome} · {new Date(item.createdAt).toLocaleString()} · {item.detail}
      </li>)}</ul>
    </s-section>
  </s-page>;
}
export const headers:HeadersFunction=args=>boundary.headers(args);
