import sanitizeHtml from "sanitize-html";
import { isIP } from "node:net";

export type ArticlePayload = {
  title: string;
  summary: string;
  body: string;
  tags: string[];
  keyword: string;
};

const allowedTags = [
  "p", "h2", "h3", "h4", "strong", "em", "ul", "ol", "li",
  "blockquote", "a", "table", "thead", "tbody", "tr", "th", "td", "code", "pre"
];

/**
 * Editorial *structure* check, not a Google ranking prediction or a factual
 * verifier. Google has no preferred word count; links are not verified citations.
 * Only a human can approve accuracy, sources, product fit and publication.
 */
export function evaluateArticle(input: unknown) {
  if (!input || typeof input !== "object") throw new Error("Article must be an object");
  const item = input as Record<string, unknown>;
  const title = String(item.title ?? "").trim().slice(0, 160);
  const summary = String(item.summary ?? "").trim().slice(0, 500);
  const keyword = String(item.keyword ?? "").trim().slice(0, 120);
  const sourceBody = String(item.body ?? "");
  if (sourceBody.length > 100_000) throw new Error("Article body exceeds limit");
  // AI-generated and merchant-edited links are never assumed trustworthy.
  // Keep normal HTTPS and store-relative links for human verification, but
  // remove unsafe destinations before saving or displaying the draft.
  const httpsHosts = new Set<string>();
  let relativeLinks = 0;
  let strippedLinks = 0;
  const body = sanitizeHtml(sourceBody, {
    allowedTags,
    allowedAttributes: { a: ["href", "title"] },
    allowedSchemes: ["https"],
    disallowedTagsMode: "discard",
    enforceHtmlBoundary: true,
    transformTags: {
      a: (tagName, attributes) => {
        const href = attributes.href;
        if (!href) return { tagName, attribs: attributes };
        const { href: _ignored, ...withoutHref } = attributes;
        // Single-slash paths are allowed for merchant internal navigation.
        // Scheme-relative // URLs and backslash URL tricks are not.
        if (href.includes(String.fromCharCode(92))) {
          strippedLinks++;
          return { tagName, attribs: withoutHref };
        }
        if (href.startsWith("/") && !href.startsWith("//")) {
          relativeLinks++;
          return { tagName, attribs: attributes };
        }
        try {
          const url = new URL(href);
          const host = url.hostname.toLowerCase();
          const ipHost = host.startsWith("[") && host.endsWith("]") ? host.slice(1, -1) : host;
          if (url.protocol === "https:" && !url.username && !url.password &&
              !url.port && host.includes(".") && !host.endsWith(".") &&
              host !== "localhost" && !host.endsWith(".localhost") &&
              !host.endsWith(".local") && isIP(ipHost) === 0) {
            httpsHosts.add(host);
            return { tagName, attribs: attributes };
          }
        } catch {
          // Malformed URL; remove the href but retain the readable anchor text.
        }
        strippedLinks++;
        return { tagName, attribs: withoutHref };
      },
    },
  });
  const tags = Array.isArray(item.tags)
    ? item.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 8).map(tag => tag.slice(0, 40).trim())
    : [];
  const plain = body.replace(/<[^>]*>/g, " ").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim();
  const words = plain ? plain.split(" ").length : 0; // descriptive only; never a quality target
  const headings = (body.match(/<h2\b/gi) ?? []).length;
  const paragraphs = (body.match(/<(?:p|li)\b/gi) ?? []).length;
  const substantiveBody = plain.length >= 120 && paragraphs > 0;
  const warnings: string[] = [];
  if (strippedLinks) {
    warnings.push(`Removed ${strippedLinks} unsafe or malformed link destination(s). Check the remaining link text before publication.`);
  }
  if (httpsHosts.size) {
    const hosts = [...httpsHosts].slice(0, 5).join(", ");
    warnings.push(`Verify ${httpsHosts.size} HTTPS link host(s) before publishing (${hosts}${httpsHosts.size > 5 ? ", …" : ""}). Check product/source accuracy and any sponsored or affiliate disclosure.`);
  }
  if (relativeLinks) {
    warnings.push(`Verify ${relativeLinks} store-relative link(s) resolve to the intended merchant pages.`);
  }
  let score = 0;
  if (title.length >= 25 && title.length <= 80) score += 25;
  else warnings.push("Review the title for clarity and specificity; 25–80 characters is a UI heuristic, not a Google ranking rule.");
  if (summary.length >= 80 && summary.length <= 220) score += 20;
  else warnings.push("Write a useful excerpt; 80–220 characters is an editorial heuristic, not a ranking rule.");
  if (substantiveBody) score += 25;
  else warnings.push("Add readable, substantive body text; the minimum is an empty-draft safeguard, not a target word count.");
  if (headings >= 1 || paragraphs >= 2) score += 15;
  else warnings.push("Organize the explanation into clear sections or paragraphs where helpful.");
  if (keyword.length > 3 && (title + " " + plain).toLowerCase().includes(keyword.toLowerCase())) score += 15;
  else warnings.push("Check the topic and primary keyword are relevant to the reader.");
  // Never reward an arbitrary word count or number of links. Neither verifies
  // originality, helpfulness, citations or the accuracy of product claims.
  if (!substantiveBody || !title || !summary) score = Math.min(score, 40);
  if (/lorem ipsum|\[insert|as an ai language model/i.test(plain)) {
    score = Math.min(score, 40);
    warnings.push("Placeholder or unedited model text detected.");
  }
  warnings.push("Links are unverified, not proof of citations. A human must check claims, source links, product facts, originality and brand fit before publishing.");
  return {
    article: { title, summary, body, tags, keyword } satisfies ArticlePayload,
    score,
    warnings,
    words,
  };
}
