import sanitizeHtml from "sanitize-html";
import { safeArticlePreviewHtml } from "./content-quality.server";

export type DraftLink = {
  href: string;
  kind: "store-relative" | "absolute-https";
  host: string | null;
  occurrences: number;
};

/**
 * Bounded, read-only link inventory for a merchant's human editorial review.
 * Parse ONLY the sanitized preview, never the untrusted stored HTML.
 * This is not a link checker, a product provenance verifier, or a publication gate.
 */
export function summarizeDraftLinks(body: string, maxLinks = 20) {
  if (!Number.isSafeInteger(maxLinks) || maxLinks < 1 || maxLinks > 50) {
    throw new Error("Invalid link review display limit");
  }
  const preview = safeArticlePreviewHtml(body);
  if (preview.unavailable) {
    return {
      links: [] as DraftLink[], uniqueTotal: 0, occurrences: 0,
      truncated: false, previewChanged: preview.changed, previewUnavailable: true,
    };
  }
  const byHref = new Map<string, DraftLink>();
  let occurrences = 0;
  // sanitize-html invokes transformTags on parsed anchors and decodes HTML
  // entities. A regex over raw HTML could accidentally report unsafe hrefs.
  sanitizeHtml(preview.html, {
    allowedTags: ["a"],
    allowedAttributes: { a: ["href"] },
    transformTags: {
      a: (tagName, attributes) => {
        const href = attributes.href;
        if (typeof href !== "string") return { tagName, attribs: attributes };
        let kind: DraftLink["kind"];
        let host: string | null = null;
        if (href.startsWith("/") && !href.startsWith("//")) {
          kind = "store-relative";
        } else {
          try {
            const url = new URL(href);
            if (url.protocol !== "https:" || url.username || url.password) {
              return { tagName, attribs: attributes };
            }
            kind = "absolute-https";
            host = url.hostname;
          } catch {
            return { tagName, attribs: attributes };
          }
        }
        occurrences++;
        const existing = byHref.get(href);
        if (existing) existing.occurrences++;
        else byHref.set(href, { href, kind, host, occurrences: 1 });
        return { tagName, attribs: attributes };
      },
    },
  });
  return {
    links: [...byHref.values()].slice(0, maxLinks),
    uniqueTotal: byHref.size,
    occurrences,
    truncated: byHref.size > maxLinks,
    previewChanged: preview.changed,
    previewUnavailable: false,
  };
}
