import { createHash } from "node:crypto";
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


/**
 * One actionable incident per keyword, search market and actual landing page,
 * not one new inbox task per scrape timestamp. Ignore fragments consistently
 * with sameRankTarget; preserve query strings (different indexed URLs).
 * The digest is an identity key, not evidence that the SERP is trustworthy.
 */
export function rankIncidentKey(market:string,targetUrl:string):string {
  const url=new URL(targetUrl);
  if(url.protocol!=="https:"||!url.hostname||url.username||url.password) {
    throw new Error("Invalid rank incident URL");
  }
  url.hash="";
  return "rank-incident:v2:"+createHash("sha256")
    .update(JSON.stringify([market,url.href])).digest("hex");
}

/**
 * Retire a pending SERP-drop alert only after a newer, same-market snapshot
 * shows the SAME page back within two positions of its pre-drop baseline.
 * This is evidence that the original sampled drop no longer holds, not proof
 * of a traffic recovery or a durable ranking trend. Missing, stale, moved,
 * or incomparable snapshots never imply recovery.
 */
export function rankingDropHasRecovered(
  sourceKey:string, evidence:string, observations:RankLike[], now=new Date()
):boolean {
  let prior:Record<string,unknown>;
  try {
    const parsed:unknown=JSON.parse(evidence);
    if(!parsed||typeof parsed!=="object"||Array.isArray(parsed))return false;
    prior=parsed as Record<string,unknown>;
  } catch { return false; }
  if(prior.source!=="brightdata-serp"||typeof prior.latestAt!=="string"||
     typeof prior.url!=="string"||typeof prior.previousRank!=="number"||!Number.isInteger(prior.previousRank)||
     (prior.previousRank as number)<1||(prior.previousRank as number)>200)return false;
  const alertAt=new Date(prior.latestAt);
  if(!Number.isFinite(alertAt.getTime())||alertAt.toISOString()!==prior.latestAt)return false;
  let market:string;
  if(sourceKey.startsWith("rank-incident:v2:")) {
    if(typeof prior.market!=="string")return false;
    try {
      if(rankIncidentKey(prior.market,prior.url)!==sourceKey)return false;
    }catch{return false;}
    market=prior.market;
  }else{
    // Historical timestamp-keyed alerts remain recoverable without rewriting
    // their original evidence or overriding prior merchant decisions.
    const suffix=":"+prior.latestAt;
    if(!sourceKey.startsWith("rank:")||!sourceKey.endsWith(suffix))return false;
    market=sourceKey.slice(5,-suffix.length);
  }
  let newest:RankLike|undefined;
  for(const row of observations){
    if([row.keyword,row.country,row.device,row.engine].join("|")!==market)continue;
    if(!newest||row.observedAt.getTime()>newest.observedAt.getTime())newest=row;
  }
  if(!newest)return false;
  const age=now.getTime()-newest.observedAt.getTime();
  if(!Number.isFinite(age)||age<0||age>14*86400000||
     newest.observedAt.getTime()<=alertAt.getTime()||
     newest.position===null||!sameRankTarget(newest.targetUrl,prior.url))return false;
  return newest.position<=(prior.previousRank as number)+2;
}

export function buildSeoTasks(findings:SeoFinding[]):SuggestedTask[] {
  return findings.slice(0,60).map(f=>({
    sourceKey:"seo:"+f.id, agent:"seo", kind:"seo_review", targetId:f.productId,
    title:f.productTitle+": "+f.kind.replace(/-/g," "),
    rationale:f.message+" Review this finding in Shopify; accepting it does not automatically edit your store.",
    evidence:JSON.stringify({source:"shopify_product_catalog",url:f.url,kind:f.kind,observedTitle:f.observedTitle}),
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
    // Multiple scrapes within minutes are not independent confirmations.
    // Select the most recent observation on each of the three most recent UTC
    // calendar dates. Do not skip any intervening date or contradictory scrape.
    // UTC is a deterministic grouping convention, not Google's GSC PT date.
    const days=new Map<string,RankLike[]>();
    for(const row of rows.sort((a,b)=>b.observedAt.getTime()-a.observedAt.getTime())){
      if(!Number.isFinite(row.observedAt.getTime()))continue;
      const day=row.observedAt.toISOString().slice(0,10);
      if(!days.has(day))days.set(day,[]);
      days.get(day)!.push(row);
    }
    const recentDays=[...days.values()].slice(0,3);
    // A two-snapshot rank change can be a transient SERP fluctuation. Require
    // two distinct later calendar days to confirm the baseline decline.
    // This is a conservative triage heuristic, NOT statistical significance.
    const latest=recentDays[0]?.[0],confirmation=recentDays[1]?.[0],baseline=recentDays[2]?.[0];
    if(!latest||!confirmation||!baseline||
       latest.position===null||confirmation.position===null||baseline.position===null||
       !sameRankTarget(latest.targetUrl,confirmation.targetUrl)||
       !sameRankTarget(confirmation.targetUrl,baseline.targetUrl))continue;
    const age=now.getTime()-latest.observedAt.getTime();
    if(age<0||age>14*86400000)continue;
    if(latest.observedAt.getTime()-confirmation.observedAt.getTime()>28*86400000||
       confirmation.observedAt.getTime()-baseline.observedAt.getTime()>28*86400000)continue;
    const confirmedLoss=confirmation.position-baseline.position;
    const latestLoss=latest.position-baseline.position;
    if(confirmedLoss<3||latestLoss<3)continue;
    // An intraday rebound, missing result, or page change contradicts a
    // sustained same-page decline, even when the day's final scrape is low.
    // This deliberately abstains rather than cherry-picking favorable samples.
    if(recentDays.slice(0,2).some(day=>day.some(row=>
      row.position===null || row.position-baseline.position!<3 ||
      !sameRankTarget(row.targetUrl,baseline.targetUrl))))continue;
    tasks.push({
      sourceKey:rankIncidentKey(key,latest.targetUrl),
      agent:"seo",kind:"ranking_drop",targetId:latest.targetUrl,
      title:"Repeated rank decline: "+latest.keyword,
      rationale:"Three distinct UTC-day same-page SERP observations: "+baseline.position+" → "+
        confirmation.position+" → "+latest.position+" (latest "+latestLoss+
        " places below baseline) on "+latest.engine+" "+latest.country+" "+latest.device+
        (latest.engine==="google"
          ? ". Check Google Search Console clicks and impressions before changing content."
          : ". Google Search Console cannot verify Bing traffic; inspect Bing Webmaster Tools before changing content.")+
        " Sampled positions do not establish lost revenue or causation.",
      evidence:JSON.stringify({source:"brightdata-serp",market:key,latestAt:latest.observedAt.toISOString(),
        confirmationAt:confirmation.observedAt.toISOString(),
        previousAt:baseline.observedAt.toISOString(),previousRank:baseline.position,
        confirmationRank:confirmation.position,latestRank:latest.position,url:latest.targetUrl}),
      priority:Math.min(88,55+Math.min(confirmedLoss,latestLoss)*3),
    });
  }
  return tasks.slice(0,30);
}
