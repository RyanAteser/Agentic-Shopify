import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
export const action = async ({request}:ActionFunctionArgs) => {
 const {shop} = await authenticate.webhook(request);
 await db.$transaction([
   db.googleAuthState.deleteMany({where:{shop}}),
   db.organicDailyMetric.deleteMany({where:{shop}}),
   db.searchConsoleConnection.deleteMany({where:{shop}}),
   db.storeActivity.deleteMany({where:{shop}}),
   db.storeRecommendation.deleteMany({where:{shop}}),
   db.articleDraft.deleteMany({where:{shop}}),
   db.seoRankObservation.deleteMany({where:{shop}}),
   db.contentJob.deleteMany({where:{shop}}),
   db.storeConfig.deleteMany({where:{shop}}),
   db.session.deleteMany({where:{shop}}),
 ]);
 return new Response();
};
