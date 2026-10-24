import type { ActionFunctionArgs } from "react-router";
import db from "../db.server";
import { authorizedBridge, dispatchArticleJob } from "../lib/agent.server";

// Called hourly by an authenticated n8n Schedule Trigger.
// Lock each due row by comparing its existing nextRunAt before advancing it.
export const action = async ({ request }: ActionFunctionArgs) => {
  if (!authorizedBridge(request)) return Response.json({ error: "Unauthorized" }, { status: 401 });
  if (request.method !== "POST") return Response.json({ error: "Method not allowed" }, { status: 405 });
  const now = new Date();
  const configs = await db.storeConfig.findMany({
    where: { enabled: true, blogId: { not: "" }, OR: [{ nextRunAt: null }, { nextRunAt: { lte: now } }] },
    take: 10, orderBy: { updatedAt: "asc" },
  });
  let launched = 0;
  for (const config of configs) {
    const cadence = Math.max(1, Math.min(30, config.cadenceDays));
    const next = new Date(now.getTime() + cadence * 86400000);
    const claimed = await db.storeConfig.updateMany({
      where: { shop: config.shop, enabled: true, nextRunAt: config.nextRunAt },
      data: { nextRunAt: next },
    });
    if (!claimed.count) continue;
    const topics = config.seedTopics.split(",").map(t => t.trim()).filter(Boolean);
    const topic = topics.length
      ? topics[Math.floor(now.getTime() / 86400000) % topics.length]
      : "Helpful practical guide for " + (config.audience || "our customers");
    const job = await db.contentJob.create({ data: { shop: config.shop, topic: topic.slice(0, 140) } });
    try {
      await dispatchArticleJob(job.id, config.shop);
      launched++;
    } catch (error) {
      await db.contentJob.update({ where: { id: job.id }, data: { status: "failed", error: String(error).slice(0, 400) } });
      console.error("Scheduled blog dispatch failed for", config.shop);
    }
  }
  return Response.json({ dueStores: configs.length, launched });
};
