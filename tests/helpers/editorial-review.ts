import db from "../../app/db.server";
import {recordEditorialReview as recordBoundReview, type ReviewDecision} from "../../app/lib/editorial-review.server";
import {reviewFormDigest} from "../../app/lib/editorial-review-integrity";

/** Test-only helper emulating a freshly rendered review form. */
export async function recordEditorialReview(
  shop:string, draftId:string, decision:ReviewDecision, reviewMinutes:number|null, feedback=""
) {
  const [draft, config] = await Promise.all([
    db.articleDraft.findFirst({where:{id:draftId,shop}}),
    db.storeConfig.findUnique({where:{shop}})
  ]);
  const digest=draft && config ? reviewFormDigest(draft,config) : "";
  return recordBoundReview(shop,draftId,decision,reviewMinutes,digest,feedback);
}
