import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Kind, parse } from "graphql";

// Prevent Shopify GraphQL comment markers from swallowing operation declarations.
// A marker like "#graphql query ..." comments out the entire declaration.
const operations = [
  ["app/lib/shopify-product-sample.ts", "ShopifySeoCatalog", "query", "template"],
  ["app/lib/product-context.server.ts", "AgenticProductContext", "query", "template"],
  ["app/lib/publish.server.ts", "ManagerPublishArticle", "mutation", "template"],
  ["app/lib/ranking-ingest.server.ts", "RankingStorefrontDomain", "query", "template"],
  ["app/routes/auth.google.callback.ts", "GrowthShopDomain", "query", "quoted"],
];

for (const [filename, operationName, operationKind, stringType] of operations) {
  test(`Shopify document ${operationName} has a parseable GraphQL operation`, () => {
    const source = readFileSync(new URL(`../${filename}`, import.meta.url), "utf8");
    const start = source.indexOf("#graphql");
    assert.ok(start >= 0, `Missing GraphQL marker in ${filename}`);
    assert.doesNotMatch(source.slice(start, start + 40), /^#graphql[ \t]+(?:query|mutation)\b/,
      "A GraphQL comment must not share the operation declaration's line");

    const end = source.indexOf(stringType === "quoted" ? '"' : "`", start);
    assert.ok(end > start, "Could not find the end of the GraphQL document");
    let documentText = source.slice(start, end);
    if (stringType === "quoted") documentText = documentText.replaceAll("\\n", "\n");
    assert.match(documentText, /^#graphql\r?\n(?:query|mutation)\b/);

    const ast = parse(documentText);
    assert.equal(ast.definitions.length, 1);
    const operation = ast.definitions[0];
    assert.equal(operation.kind, Kind.OPERATION_DEFINITION);
    assert.equal(operation.operation, operationKind);
    assert.equal(operation.name?.value, operationName);
  });
}
