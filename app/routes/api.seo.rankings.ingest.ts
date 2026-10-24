import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { authorizedBridge } from "../lib/agent.server";
import { parseRanking } from "../lib/seo";

/**
 * Private, server-side bridge for Bright Data ranking observations.
 * The existing n8n tracker sends normalized measurements here.
 * Does not expose Shopify tokens or permit publishing/modifications.
 */
export const action = async ({request}: ActionFunctionArgs) => {
  if (!authorizedBridge(request)) return Response.json({error:"Unauthorized"},{status:401});
  if (request.method !== "POST") return Response.json({error:"Method not allowed"},{status:405});
  if (Number(request.headers.get("content-length")||0)>100_000) {
    return Response.json({error:"Payload too large"},{status:413});
  }
  try {
    const raw=await request.text();
    if (raw.length>100_000) return Response.json({error:"Payload too large"},{status:413});
    const input=JSON.parse(raw) as {shop?:unknown;rows?:unknown};
    const shop=input.shop;
    if (typeof shop!=="string" || !/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)) {
      return Response.json({error:"Invalid shop"},{status:400});
    }
    if (!Array.isArray(input.rows) || !input.rows.length || input.rows.length>100) {
      return Response.json({error:"Expected 1-100 ranking records"},{status:400});
    }
    const config=await db.storeConfig.findUnique({where:{shop},select:{shop:true}});
    if (!config) return Response.json({error:"Store is not enrolled"},{status:404});
    const readings=input.rows.map(r=>parseRanking(r));
    for (const reading of readings) {
      const identity={
        shop, keyword:reading.keyword, engine:reading.engine, country:reading.country,
        device:reading.device, observedAt:reading.observedAt,
      };
      await db.seoRankObservation.upsert({
        where:{shop_keyword_engine_country_device_observedAt:identity},
        create:{...identity,position:reading.position,targetUrl:reading.targetUrl,source:reading.source},
        update:{position:reading.position,targetUrl:reading.targetUrl},
      });
    }
    return Response.json({ok:true,accepted:readings.length,source:"brightdata-serp"});
  } catch (error) {
    console.error("Rank observation ingest rejected:",error instanceof Error?error.message:"unknown");
    return Response.json({error:"Invalid ranking payload"},{status:400});
  }
};
