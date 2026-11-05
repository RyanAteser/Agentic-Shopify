import sanitizeHtml from "sanitize-html";
import { safeArticlePreviewHtml } from "./content-quality.server";

export type DraftLink = {
  href: string;
  kind: "store-relative" | "absolute-https";
  host: string | null;
  occurrences: number;
  emptyAnchorText: number;
  genericAnchorText: number;
};

/**
 * Bounded, read-only link inventory for a merchant's human editorial review.
 * Parse ONLY the sanitized preview, never the untrusted stored HTML.
 * This is not a link checker, a product provenance verifier, or a publication gate.
 * High-confidence anchor-text warnings follow Google's link guidance, but are
 * editorial prompts, not SEO scores or proof of ranking impact.
 */
export function summarizeDraftLinks(body: string, maxLinks = 20) {
  if (!Number.isSafeInteger(maxLinks) || maxLinks < 1 || maxLinks > 50) {
    throw new Error("Invalid link review display limit");
  }
  const preview = safeArticlePreviewHtml(body);
  if (preview.unavailable) {
    return {
      links: [] as DraftLink[], uniqueTotal: 0, occurrences: 0,
      emptyAnchorOccurrences: 0, genericAnchorOccurrences: 0,
      truncated: false, previewChanged: preview.changed, previewUnavailable: true,
    };
  }
  const byHref = new Map<string, DraftLink>();
  let occurrences = 0;
  let emptyAnchorOccurrences = 0;
  let genericAnchorOccurrences = 0;
  const genericLabels = new Set(["click here", "here", "read more", "learn more", "more", "link"]);
  // exclusiveFilter exposes the final sanitized href and text at the closing
  // anchor. Never inspect the original unsanitized markup for review evidence.
  sanitizeHtml(preview.html, {
    allowedTags: ["a", "strong", "em", "code"],
    allowedAttributes: { a: ["href", "title"] },
    exclusiveFilter: frame => {
      if (frame.tag !== "a") return false;
      const href = frame.attribs.href;
      if (typeof href !== "string") return false;
      let kind: DraftLink["kind"];
      let host: string | null = null;
      if (href.startsWith("/") && !href.startsWith("//")) {
        kind = "store-relative";
      } else {
        try {
          const url = new URL(href);
          if (url.protocol !== "https:" || url.username || url.password) return false;
          kind = "absolute-https";
          host = url.hostname;
        } catch {
          return false;
        }
      }
      const normalized = (text: string) =>
        text.replace(/\s+/g, " ").trim().toLowerCase().replace(/[.!?]+$/, "").trim();
      // Google can fall back to a title attribute when link text is absent.
      // This intentionally flags only obvious cases; no linguistic inference.
      const label = normalized(frame.text) || normalized(frame.attribs.title ?? "");
      const empty = !label;
      const generic = genericLabels.has(label);
      occurrences++;
      if (empty) emptyAnchorOccurrences++;
      if (generic) genericAnchorOccurrences++;
      const existing = byHref.get(href);
      if (existing) {
        existing.occurrences++;
        if (empty) existing.emptyAnchorText++;
        if (generic) existing.genericAnchorText++;
      } else {
        byHref.set(href, {
          href, kind, host, occurrences: 1,
          emptyAnchorText: empty ? 1 : 0,
          genericAnchorText: generic ? 1 : 0,
        });
      }
      return false;
    },
  });
  return {
    links: [...byHref.values()].slice(0, maxLinks),
    uniqueTotal: byHref.size,
    occurrences,
    emptyAnchorOccurrences, genericAnchorOccurrences,
    truncated: byHref.size > maxLinks,
    previewChanged: preview.changed,
    previewUnavailable: false,
  };
}
