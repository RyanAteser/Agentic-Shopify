import db from "../../app/db.server";
import {publishApprovedArticle} from "../../app/lib/publish.server";
import {publishFormDigest} from "../../app/lib/editorial-review-integrity";

/**
 * Test-only simulation of a freshly rendered merchant Publish form.
 * Explicit stale/missing-form regression tests call publishApprovedArticle
 * directly with the previously rendered version.
 */
export async function publishFromCurrentForm(
  shop:string,draftId:string,admin:Parameters<typeof publishApprovedArticle>[2]
) {
  const [draft,destination]=await Promise.all([
    db.articleDraft.findFirst({where:{id:draftId,shop}}),
    db.storeConfig.findUnique({where:{shop}})
  ]);
  return publishApprovedArticle(shop,draftId,admin,
    draft&&destination?publishFormDigest(draft,destination):"");
}
