import { createHash } from "node:crypto";

/**
 * A usable human review approves a specific publication payload and destination,
 * not an article ID forever. Changes to any of these fields invalidate approval.
 *
 * Hashing is an integrity comparison, not a signature or proof a human read it.
 * The version marker makes future payload changes fail closed.
 */
export type ReviewedArticleFields = {
  title: string;
  body: string;
  summary: string;
  tags: string;
};
export type ReviewedDestination = { blogId: string; authorName: string };
export type ReviewEvidence = { decision: string; contentDigest: string };

export function publicationReviewDigest(
  article: ReviewedArticleFields, destination: ReviewedDestination
): string {
  return createHash("sha256")
    .update(JSON.stringify([
      "shopify-article-publication-v1",
      destination.blogId, destination.authorName,
      article.title, article.body, article.summary, article.tags
    ]), "utf8")
    .digest("hex");
}

export function hasCurrentUsableReview(
  review: ReviewEvidence | null | undefined,
  article: ReviewedArticleFields,
  destination: ReviewedDestination
): boolean {
  return review?.decision === "usable" &&
    review.contentDigest === publicationReviewDigest(article, destination);
}
