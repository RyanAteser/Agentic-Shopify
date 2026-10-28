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

/**
 * Browser-rendered Publish confirmation version. This is deliberately separate
 * from the stored editorial approval digest: a prior approval must not act as
 * permission to publish content changed since this particular page loaded.
 * Not a secret or proof of human inspection.
 */
export function publishFormDigest(
  article: ReviewedArticleFields, destination: ReviewedDestination
): string {
  return createHash("sha256")
    .update(JSON.stringify([
      "shopify-publish-form-v1", publicationReviewDigest(article, destination)
    ]), "utf8")
    .digest("hex");
}

/** Version of the precise article, editorial keyword and destination displayed to a reviewer. */
export function reviewFormDigest(
  article: ReviewedArticleFields & { keyword: string }, destination: ReviewedDestination
): string {
  return createHash("sha256")
    .update(JSON.stringify([
      "shopify-editorial-review-form-v1", publicationReviewDigest(article, destination), article.keyword
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
