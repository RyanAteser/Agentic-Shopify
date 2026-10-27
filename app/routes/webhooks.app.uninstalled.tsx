import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import db from "../db.server";
export const action = async ({request}:ActionFunctionArgs) => {
 const {shop} = await authenticate.webhook(request);
 await db.$transaction([
   // Lock/delete the merchant configuration FIRST: a concurrent ranking import
   // locks this same row before inserting observations. Deleting it before
   // ranking rows ensures uninstall/redaction cannot leave orphaned ranks.
   db.storeConfig.deleteMany({where:{shop}}),
   db.rankingConnectorCredential.deleteMany({where:{shop}}),
   db.googleAuthState.deleteMany({where:{shop}}),
   // Delete the connection before metrics so an in-flight GSC import cannot
   // reinsert observations after the redaction transaction has deleted them.
   db.searchConsoleConnection.deleteMany({where:{shop}}),
   db.organicDailyMetric.deleteMany({where:{shop}}),
   db.storeActivity.deleteMany({where:{shop}}),
   db.storeRecommendation.deleteMany({where:{shop}}),
   db.articleDraft.deleteMany({where:{shop}}),
   db.seoRankObservation.deleteMany({where:{shop}}),
   db.contentJob.deleteMany({where:{shop}}),
   db.session.deleteMany({where:{shop}}),
 ]);
 return new Response();
};
