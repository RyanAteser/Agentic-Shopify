/**
 * Shopify ArticleCreateInput.summary is HTML, but our editorial excerpt is
 * collected and displayed as plain text. Encode it at the Shopify boundary
 * so model-generated or imported markup cannot become executable HTML.
 * Do not decode existing entities: a literal entity in a merchant draft must
 * remain literal instead of being interpreted as markup by a theme.
 */
export function toSafeShopifySummaryHtml(summary: string): string {
  return summary
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
