import sanitizeHtml from "sanitize-html";

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

export function evaluateArticle(input: unknown) {
  if (!input || typeof input !== "object") throw new Error("Article must be an object");
  const item = input as Record<string, unknown>;
  const title = String(item.title ?? "").trim().slice(0, 160);
  const summary = String(item.summary ?? "").trim().slice(0, 500);
  const keyword = String(item.keyword ?? "").trim().slice(0, 120);
  const sourceBody = String(item.body ?? "");
  if (sourceBody.length > 100_000) throw new Error("Article body exceeds limit");
  const body = sanitizeHtml(sourceBody, {
    allowedTags,
    allowedAttributes: { a: ["href", "title"] },
    allowedSchemes: ["http", "https"],
    disallowedTagsMode: "discard",
    enforceHtmlBoundary: true,
  });
  const tags = Array.isArray(item.tags)
    ? item.tags.filter((tag): tag is string => typeof tag === "string").slice(0, 8).map(tag => tag.slice(0, 40).trim())
    : [];
  const plain = body.replace(/<[^>]*>/g, " ").replace(/&[^;]+;/g, " ").replace(/\s+/g, " ").trim();
  const words = plain ? plain.split(" ").length : 0;
  const headings = (body.match(/<h2\b/gi) ?? []).length;
  const citations = (body.match(/<a\s/gi) ?? []).length;
  const warnings: string[] = [];
  let score = 0;
  if (title.length >= 25 && title.length <= 80) score += 20;
  else warnings.push("Improve the title: aim for a clear, specific 25–80 character title.");
  if (summary.length >= 80 && summary.length <= 220) score += 15;
  else warnings.push("Write a specific 80–220 character excerpt.");
  if (words >= 450) score += 30;
  else warnings.push("Body is thin; add original, useful and accurate detail.");
  if (headings >= 2) score += 15;
  else warnings.push("Use at least two useful H2 sections.");
  if (keyword.length > 3 && (title + " " + plain).toLowerCase().includes(keyword.toLowerCase())) score += 10;
  else warnings.push("Check the primary keyword is relevant to the topic.");
  if (citations >= 1) score += 10;
  else warnings.push("Add verifiable citations when claims rely on outside evidence.");
  // This is a structural checklist, NOT proof of factual accuracy or ranking potential.
  if (/lorem ipsum|\[insert|as an ai language model/i.test(plain)) {
    score = Math.min(score, 40);
    warnings.push("Placeholder or unedited model text detected.");
  }
  warnings.push("Human editor must verify claims, source links, product facts and brand fit.");
  return {
    article: { title, summary, body, tags, keyword } satisfies ArticlePayload,
    score,
    warnings,
    words,
  };
}
