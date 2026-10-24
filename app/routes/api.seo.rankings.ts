import * as crypto from "node:crypto";
import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { parseRanking } from "../lib/seo";

function authenticated(request:Request) {
  const expected=process.env.N8N_RANKING_SECRET;
  const actual=request.headers.get("X-Agent-Key");
  if (!expected || !actual) return false;
  const digest=(x:string)=>crypto.createHash("sha256").update(x).digest();
  return crypto.timingSafeEqual(digest(expected),digest(actual));
}
export const action = async ({request}:ActionFunctionArgs) => {
  if (request.method!=="POST") return Response.json({error:"Method not allowed"},{status:405});
  if (!authenticated(request)) return Response.json({error:"Unauthorized"},{status:401});
  if (Number(request.headers.get("content-length")||"0") > 75_000) return Response.json({error:"Payload too large"},{status:413});
  try {
    const text=await request.text();
    if (text.length>75_000) return Response.json({error:"Payload too large"},{status:413});
    const value=JSON.parse(text);
    const shop=String(value.shop||"");
    if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
      return Response.json({error:"Invalid Shopify tenant"},{status:400});
    }
    // A trusted server-to-server connector must identify a previously installed store.
    if (!await db.storeConfig.findUnique({where:{shop},select:{shop:true}})) {
      return Response.json({error:"Store not connected"},{status:404});
    }
    if (!Array.isArray(value.observations) || !value.observations.length || value.observations.length>50) {
      return Response.json({error:"Expect 1-50 ranking records"},{status:400});
    }
    const now=new Date();
    const entries=value.observations.map((item:unknown)=>parseRanking(item,now));
    // Upsert makes replaying the same observed snapshot idempotent.
    for (const entry of entries) {
      await db.seoRankObservation.upsert({
        where:{shop_keyword_engine_country_device_observedAt:{
          shop,keyword:entry.keyword,engine:entry.engine,country:entry.country,
          device:entry.device,observedAt:entry.observedAt
        }},
        create:{shop,...entry},
        update:{position:entry.position,targetUrl:entry.targetUrl,source:entry.source}
      });
    }
    return Response.json({ok:true,records:entries.length,shop});
  } catch (e) {
    return Response.json({error: e instanceof Error?e.message:"Invalid data"},{status:400});
  }
};
