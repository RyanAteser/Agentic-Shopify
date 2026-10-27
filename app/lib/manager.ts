import type { SeoFinding } from "./seo";

/** Pure evidence-backed task builder. No model-generated figures or external mutations. */
export type SuggestedTask = {
  sourceKey: string; agent: string; kind: string; targetId: string;
  title: string; rationale: string; evidence: string; priority: number;
};
export type DraftLike={id:string;title:string;topic:string;seoScore:number;status:string;reviewNotes:string};
export type RankLike={keyword:string;position:number|null;country:string;device:string;observedAt:Date;targetUrl:string;engine:string};

/**
 * A change of ranking URL is not evidence that the same page lost positions.
 * Only compare consecutive snapshots of the same HTTPS result URL. Ignore URL
 * fragments, which are not sent to servers; retain paths and query strings
 * because they can identify genuinely different indexed pages.
 */
export function sameRankTarget(a:string,b:string):boolean {
  if(!a||!b)return false;
  try {
    const left=new URL(a),right=new URL(b);
    if(left.protocol!=="https:"||right.protocol!=="https:"||
       left.username||left.password||right.username||right.password)return false;
    left.hash="";right.hash="";
    return left.href===right.href;
  }catch{return false;}
}

export function buildSeoTasks(findings:SeoFinding[]):SuggestedTask[] {
  return findings.slice(0,60).map(f=>({
    sourceKey:"seo:"+f.id, agent:"seo", kind:"seo_review", targetId:f.productId,
    title:f.productTitle+": "+f.kind.replace(/-/g," "),
    rationale:f.message+" Review this finding in Shopify; accepting it does not automatically edit your store.",
    evidence:JSON.stringify({source:"shopify_product_catalog",url:f.url,kind:f.kind}),
    priority:f.severity==="high"?85:60,
  }));
}
export function buildBlogTasks(drafts:DraftLike[]):SuggestedTask[] {
  return drafts.filter(d=>["ready","needs_review"].includes(d.status)).slice(0,30).map(d=>({
    sourceKey:"blog:"+d.id,agent:"content",kind:d.status==="ready" && d.seoScore>=70?"blog_publish":"blog_review",
    targetId:d.id,title:d.title,
    rationale:d.status==="ready" && d.seoScore>=70
      ? "Article is ready for human factual review before publishing. Structural score "+d.seoScore+"/100 is not proof of accuracy."
      : "Article requires human editing before publishing. Review its warnings in Blog Agent.",
    evidence:JSON.stringify({source:"app_article_draft",topic:d.topic,seoScore:d.seoScore,reviewNotes:d.reviewNotes.slice(0,600)}),
    priority:d.status==="ready" && d.seoScore>=70?75:55,
  }));
}
export function buildRankTasks(records: RankLike[], now=new Date()):SuggestedTask[] {
  // Compare equal keyword+country+device+engine only; ignore stale or incomparable observations.
  const groups=new Map<string,RankLike[]>();
  for(const r of records){
    const key=[r.keyword,r.country,r.device,r.engine].join("|");
    groups.set(key,[...(groups.get(key)||[]),r]);
  }
  const tasks:SuggestedTask[]=[];
  for(const [key,rows] of groups){
    const distinct=rows.sort((a,b)=>b.observedAt.getTime()-a.observedAt.getTime())
      .filter((r,i,arr)=>i===0||r.observedAt.getTime()!==arr[i-1].observedAt.getTime());
    const latest=distinct[0],previous=distinct[1];
    if(!latest||!previous||latest.position===null||previous.position===null||
       !sameRankTarget(latest.targetUrl,previous.targetUrl)) continue;
    if(now.getTime()-latest.observedAt.getTime()>14*86400000)continue;
    if(latest.observedAt.getTime()-previous.observedAt.getTime()>28*86400000)continue;
    const lost=latest.position-previous.position;
    if(lost<3)continue;
    tasks.push({
      sourceKey:"rank:"+key+":"+latest.observedAt.toISOString(),
      agent:"seo",kind:"ranking_drop",targetId:latest.targetUrl,
      title:"Keyword slipped: "+latest.keyword,
      rationale:"Observed organic position moved from "+previous.position+" to "+latest.position+
        " ("+lost+" places) on "+latest.engine+" "+latest.country+" "+latest.device+
        ". Check recent SERP conditions; this is not evidence of lost revenue or causation.",
      evidence:JSON.stringify({source:"brightdata-serp",latestAt:latest.observedAt.toISOString(),
        previousAt:previous.observedAt.toISOString(),previousRank:previous.position,latestRank:latest.position,
        url:latest.targetUrl}),
      priority:Math.min(88,55+lost*3),
    });
  }
  return tasks.slice(0,30);
}
