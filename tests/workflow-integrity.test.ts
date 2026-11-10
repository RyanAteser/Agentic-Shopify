import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
type NodeShape = { name: string; type: string };
type Workflow = { nodes: NodeShape[]; connections: Record<string, { main: Array<Array<{ node: string }>> }>; active: boolean };
function load(path: string): Workflow { return JSON.parse(readFileSync(path, "utf8")) as Workflow; }
test("writer workflow references only existing nodes and starts inactive", () => {
  const workflow = load("n8n/shopify-blog-writer.json");
  assert.equal(workflow.active, false);
  assert.ok(workflow.nodes.length >= 5);
  const names = new Set(workflow.nodes.map(n => n.name));
  assert.equal(names.size, workflow.nodes.length);
  for (const [source, ports] of Object.entries(workflow.connections)) {
    assert.ok(names.has(source), "Missing source: " + source);
    for (const output of ports.main) for (const edge of output) assert.ok(names.has(edge.node), "Missing target: " + edge.node);
  }
  const raw = readFileSync("n8n/shopify-blog-writer.json", "utf8");
  assert.ok(raw.includes("agentic-shopify-blog-generate"));
  assert.ok(raw.includes("Parse Reviewed Article"));
  assert.ok(raw.includes("httpHeaderAuth"));
  assert.doesNotMatch(raw, /sk-proj-[a-zA-Z0-9]{12,}/);
  assert.doesNotMatch(raw, /shpat_[a-zA-Z0-9]{12,}/);
});
test("writer returns a job-and-tenant-scoped 202 before paid generation, not a generic HTTP 200", () => {
  const workflow = load("n8n/shopify-blog-writer.json");
  type AckNode = NodeShape & { parameters: Record<string, unknown> };
  const nodes = workflow.nodes as AckNode[];
  const find = (name: string): AckNode => {
    const node = nodes.find(n => n.name === name);
    assert.ok(node, "Missing node " + name);
    return node;
  };
  assert.equal(find("Receive Draft Request").parameters.responseMode, "responseNode");
  const ack = find("Acknowledge Job Acceptance");
  assert.equal(ack.type, "n8n-nodes-base.respondToWebhook");
  assert.equal(ack.parameters.respondWith, "json");
  assert.equal((ack.parameters.options as { responseCode: number }).responseCode, 202);
  assert.equal(workflow.connections["Prepare Brief"].main[0][0].node, ack.name);
  assert.equal(workflow.connections[ack.name].main[0][0].node, "Draft Article");
  const expression = ack.parameters.responseBody;
  assert.equal(typeof expression, "string");
  assert.ok((expression as string).startsWith("={{ ") && (expression as string).endsWith(" }}"));
  const code = (expression as string).slice(3, -3);
  const result = runInNewContext(code, {
    $json: { jobId: "job-123", shop: "example.myshopify.com" }
  }) as string;
  assert.deepEqual(JSON.parse(result), {
    accepted: true, jobId: "job-123", shop: "example.myshopify.com"
  });
  assert.equal(workflow.active, false, "No workflow activation permitted in development");
});

test("hourly scheduler is inert until configured", () => {
  const workflow = load("n8n/shopify-blog-scheduler.json");
  assert.equal(workflow.active, false);
  assert.ok(workflow.nodes.some(n => n.type.includes("scheduleTrigger")));
  const raw = readFileSync("n8n/shopify-blog-scheduler.json", "utf8");
  assert.ok(raw.includes("YOUR-PUBLISHED-SHOPIFY-APP.example"));
  assert.ok(raw.includes("httpHeaderAuth"));
});

test("Store Manager hourly workflow only calls the bounded read-only task refresh endpoint",()=>{
  const raw=readFileSync("n8n/shopify-store-manager.json","utf8");
  const workflow=load("n8n/shopify-store-manager.json");
  assert.equal(workflow.active,false);
  assert.equal(workflow.nodes.length,2);
  assert.ok(raw.includes("/api/manager/sync"));
  assert.ok(raw.includes("httpHeaderAuth"));
  assert.doesNotMatch(raw,/shpat_[a-zA-Z0-9]{12,}/);
  assert.doesNotMatch(raw,/\bsk-proj-[a-zA-Z0-9]{12,}/);
});

test("Growth workflow imports verified GSC data but cannot modify Shopify",()=>{
  const raw=readFileSync("n8n/shopify-growth-gsc-sync.json","utf8");
  const workflow=load("n8n/shopify-growth-gsc-sync.json");
  assert.equal(workflow.active,false);
  assert.equal(workflow.nodes.length,2);
  assert.ok(raw.includes("/api/growth/sync"));
  assert.ok(raw.includes("httpHeaderAuth"));
  assert.doesNotMatch(raw,/shpat_[a-zA-Z0-9]{12,}/);
});


test("writer callback destination is operator-pinned and cannot be changed by webhook input", () => {
  const workflow = load("n8n/shopify-blog-writer.json");
  const nodes = workflow.nodes as Array<{
    name: string;
    type: string;
    parameters: {
      url?: string;
      jsCode?: string;
      genericAuthType?: string;
      options?: { redirect?: { redirect?: { followRedirects?: boolean } } };
    };
  }>;
  const find = (name: string) => {
    const node = nodes.find(node => node.name === name);
    assert.ok(node, "Missing workflow node: " + name);
    return node;
  };
  const callback = find("Return Secure Draft");
  assert.equal(callback.parameters.url, "https://YOUR-PUBLISHED-SHOPIFY-APP.example/api/agent/complete");
  assert.doesNotMatch(callback.parameters.url!, /^=/, "Callback URL must never be an expression");
  for (const node of nodes.filter(node => node.type === "n8n-nodes-base.httpRequest" &&
    node.parameters.genericAuthType === "httpHeaderAuth")) {
    assert.equal(node.parameters.options?.redirect?.redirect?.followRedirects, false,
      "Credential-bearing HTTP requests must not follow redirects: " + node.name);
  }
  const untrusted = {
    jobId: "job-1", shop: "demo.myshopify.com", topic: "boots",
    callbackToken: "a".repeat(43), productCatalog: [], productCatalogHasMore: false,
    productCatalogSampledCount: 0, productCatalogMissingUrls: 0,
    callbackUrl: "https://attacker.example/collect-credentials", brief: {}
  };
  const prepared = runInNewContext("(() => {" + find("Prepare Brief").parameters.jsCode + "})()", {
    $input: { first: () => ({ json: { body: untrusted } }) }
  }) as Array<{ json: Record<string, unknown> }>;
  assert.equal(prepared[0].json.jobId, untrusted.jobId);
  assert.equal(prepared[0].json.shop, untrusted.shop);
  assert.equal(prepared[0].json.callbackToken, untrusted.callbackToken);
  assert.equal("callbackUrl" in prepared[0].json, false);
  const reviewed = runInNewContext("(() => {" + find("Parse Reviewed Article").parameters.jsCode + "})()", {
    $: () => ({ first: () => prepared[0] }),
    $input: { first: () => ({ json: { choices: [{ finish_reason: "stop", message: {
      content: JSON.stringify({ title: "Boot guide", summary: "A guide", body: "<p>Useful</p>" })
    } }] } }) }
  }) as Array<{ json: Record<string, unknown> }>;
  assert.equal(reviewed[0].json.jobId, untrusted.jobId);
  assert.equal(reviewed[0].json.shop, untrusted.shop);
  assert.equal(reviewed[0].json.callbackToken, untrusted.callbackToken);
  assert.equal("callbackUrl" in reviewed[0].json, false);
  const dispatchSource = readFileSync("app/lib/agent.server.ts", "utf8");
  assert.doesNotMatch(dispatchSource, /callbackUrl/,
    "App must not send an attacker-controllable callback URL to n8n");
  assert.match(dispatchSource, /deliverClaimedN8nJob/,
    "App must route dispatch through the tested transport helper");
  const deliverySource = readFileSync("app/lib/n8n-delivery.server.ts", "utf8");
  assert.match(deliverySource, /redirect:\s*"error"/,
    "App-to-n8n authenticated dispatch must reject redirects");
});

test("all inactive n8n workflows pin safe execution persistence until upstream zero-output fix is verified", () => {
  // n8n issue #38551: on affected versions, saveDataSuccessExecution=none
  // can strand zero-output runs as 'running'. Do not inherit that setting.
  const paths = [
    "n8n/shopify-blog-writer.json",
    "n8n/shopify-blog-scheduler.json",
    "n8n/shopify-growth-gsc-sync.json",
    "n8n/shopify-queued-recovery.json",
    "n8n/shopify-store-manager.json"
  ];
  for (const path of paths) {
    const workflow = JSON.parse(readFileSync(path, "utf8")) as Workflow & {
      settings: {
        saveDataSuccessExecution?: string;
        saveDataErrorExecution?: string;
        saveManualExecutions?: boolean;
        saveExecutionProgress?: boolean;
      };
    };
    assert.equal(workflow.active, false, path + " must remain inactive");
    assert.equal(workflow.settings.saveDataSuccessExecution, "all",
      path + " must not inherit the known zero-output persistence hazard");
    assert.equal(workflow.settings.saveDataErrorExecution, "all",
      path + " retains bounded incident-reconciliation evidence");
    assert.equal(workflow.settings.saveManualExecutions, false,
      path + " must not persist manual test inputs by default");
    assert.equal(workflow.settings.saveExecutionProgress, false,
      path + " must not persist intermediate node payloads");
  }
});

test("writer caps both paid model stages and refuses incomplete model responses", () => {
  const workflow = load("n8n/shopify-blog-writer.json");
  const nodes = workflow.nodes as Array<NodeShape & { parameters: { jsonBody?: string; jsCode?: string } }>;
  const find = (name: string) => {
    const node = nodes.find(n => n.name === name);
    assert.ok(node, "Missing workflow node: " + name);
    return node;
  };
  for (const name of ["Draft Article", "Editorial Revision"]) {
    const expression = find(name).parameters.jsonBody;
    if (typeof expression !== "string") throw new Error("Missing JSON body expression: " + name);
    assert.ok(expression.startsWith("={{ ") && expression.endsWith(" }}"));
    const payload = JSON.parse(runInNewContext(expression.slice(3, -3), {
      $json: { system: "System", user: "User", first: { title: "Example", body: "<p>Test</p>" } }
    }) as string);
    assert.equal(payload.model, "gpt-4.1-mini");
    assert.equal(payload.max_completion_tokens, 3000, name + " must have a hard output cap");
    assert.equal(payload.n ?? 1, 1, "Do not pay for multiple choices");
  }
  const article = {
    title: "A useful article", summary: "An informative summary",
    body: "<p>Carefully verified text.</p>", keyword: "article", tags: []
  };
  for (const [name, context] of [
    ["Parse Draft", { $: () => ({ first: () => ({ json: { jobId: "j", shop: "s" } }) }) }],
    ["Parse Reviewed Article", { $: () => ({ first: () => ({ json: { jobId: "j", shop: "s" } }) }) }]
  ] as const) {
    const code = find(name).parameters.jsCode;
    assert.ok(code);
    const execute = (finish_reason: string | undefined) => runInNewContext(
      "(() => {" + code + "})()",
      { ...context, $input: { first: () => ({ json: {
        choices: [{ finish_reason, message: { content: JSON.stringify(article) } }]
      } }) } }
    ) as Array<{ json: Record<string, unknown> }>;
    assert.equal(execute("stop").length, 1, name);
    for (const reason of ["length", "content_filter", "tool_calls", undefined]) {
      assert.throws(() => execute(reason), /did not finish normally/, name + ": " + reason);
    }
  }
});

test("writer returns a per-job callback capability, never a global callback credential", () => {
  const workflow = load("n8n/shopify-blog-writer.json");
  const nodes = workflow.nodes as Array<NodeShape & { parameters: Record<string, any> }>;
  const callback = nodes.find(n => n.name === "Return Secure Draft");
  assert.ok(callback);
  assert.equal(callback.parameters.authentication, "none");
  assert.equal(callback.parameters.sendHeaders, true);
  assert.equal(callback.parameters.genericAuthType, undefined);
  const headers = callback.parameters.headerParameters?.parameters;
  assert.equal(headers?.length, 1);
  assert.equal(headers[0].name, "X-Agent-Key");
  assert.equal(headers[0].value, "={{ $json.callbackToken }}");
  assert.equal(runInNewContext(headers[0].value.slice(3, -3), {
    $json: { callbackToken: "job-specific-capability" }
  }), "job-specific-capability");
  assert.doesNotMatch(callback.parameters.jsonBody, /callbackToken/,
    "The token must travel in an HTTP header, not the JSON article payload");
  const prepare = nodes.find(n => n.name === "Prepare Brief");
  assert.ok(prepare);
  assert.throws(() => runInNewContext("(() => {" + prepare.parameters.jsCode + "})()", {
    $input: { first: () => ({ json: { body: {
      jobId: "j", shop: "s", topic: "t"
    } } }) }
  }), /Missing or invalid app job capability/);
  assert.equal(workflow.active, false);
});

test("writer packs complete product URLs into parseable bounded JSON instead of slicing the brief", () => {
  const workflow = load("n8n/shopify-blog-writer.json");
  const prepare = (workflow.nodes as Array<NodeShape & { parameters: { jsCode?: string } }>)
    .find(node => node.name === "Prepare Brief");
  assert.ok(prepare?.parameters.jsCode);
  const catalog = Array.from({ length: 20 }, (_, i) => ({
    name: "Product " + i,
    description: "D".repeat(400),
    url: "https://merchant.example/products/" + i + "-" + "z".repeat(300)
  }));
  const input = {
    jobId: "job-1", shop: "merchant.myshopify.com", topic: "Useful products",
    callbackToken: "a".repeat(43), productCatalog: catalog, productCatalogHasMore: false,
    productCatalogSampledCount: 20, productCatalogMissingUrls: 0,
    brief: {
      audience: "a".repeat(2000), brandVoice: "b".repeat(2000),
      seedTopics: "c".repeat(2000),
      avoidPatterns: Array.from({ length: 4 }, () => ({
        topic: "t".repeat(1000), reason: "r".repeat(1000)
      })),
      priorPublishedTitles: Array.from({ length: 8 }, () => "p".repeat(500))
    }
  };
  const prepared = runInNewContext("(() => {" + prepare.parameters.jsCode + "})()", {
    $input: { first: () => ({ json: { body: input } }) }
  }) as Array<{ json: { user: string; jobId: string; callbackToken: string } }>;
  const prefix = "Write a useful article from this merchant brief: ";
  assert.ok(prepared[0].json.user.startsWith(prefix));
  const json = prepared[0].json.user.slice(prefix.length);
  assert.ok(json.length <= 10000);
  const context = JSON.parse(json) as {
    audience: string; productCountSampled: number; productSampleTruncated: boolean;
    verifiedStoreProducts: Array<{ name: string; description: string; url: string }>;
  };
  assert.equal(context.audience.length, 500);
  assert.equal(context.productCountSampled, 20);
  assert.equal(context.productSampleTruncated, true);
  assert.ok(context.verifiedStoreProducts.length > 0 && context.verifiedStoreProducts.length < 20);
  assert.ok(context.verifiedStoreProducts.every(p => catalog.some(original => original.url === p.url)),
    "No product URL may be truncated or synthesized");
  assert.equal(prepared[0].json.jobId, input.jobId);
  assert.equal(prepared[0].json.callbackToken, input.callbackToken);
});

test("writer excludes over-budget product URLs and marks omitted products without fabricating catalog completeness", () => {
  const workflow = load("n8n/shopify-blog-writer.json");
  const prepare = (workflow.nodes as Array<NodeShape & { parameters: { jsCode?: string } }>)
    .find(node => node.name === "Prepare Brief");
  assert.ok(prepare?.parameters.jsCode);
  const good = "https://merchant.example/products/mug";
  const input = {
    jobId: "job-2", shop: "merchant.myshopify.com", topic: "Mug guide",
    callbackToken: "b".repeat(43), productCatalogHasMore: false,
    productCatalogSampledCount: 2, productCatalogMissingUrls: 0,
    productCatalog: [
      { name: "Mug", description: "A reusable cup", url: good },
      { name: "Too long", description: "Unusable", url: good + "x".repeat(400) }
    ],
    brief: {}
  };
  const result = runInNewContext("(() => {" + prepare.parameters.jsCode + "})()", {
    $input: { first: () => ({ json: { body: input } }) }
  }) as Array<{ json: { user: string } }>;
  const context = JSON.parse(result[0].json.user.split("brief: ")[1]);
  assert.equal(context.productCountSampled, 2);
  assert.equal(context.productSampleTruncated, true);
  assert.deepEqual(context.verifiedStoreProducts, [
    { name: "Mug", description: "A reusable cup", url: good }
  ]);
  const empty = runInNewContext("(() => {" + prepare.parameters.jsCode + "})()", {
    $input: { first: () => ({ json: { body: { ...input, productCatalog: [], productCatalogSampledCount: 0 } } }) }
  }) as Array<{ json: { user: string } }>;
  const emptyContext = JSON.parse(empty[0].json.user.split("brief: ")[1]);
  assert.equal(emptyContext.productCountSampled, 0);
  assert.equal(emptyContext.productSampleTruncated, false);
  assert.deepEqual(emptyContext.verifiedStoreProducts, []);
});


test("writer marks an otherwise fitting 20-product Shopify sample incomplete when more pages exist", () => {
  const workflow = load("n8n/shopify-blog-writer.json");
  const prepare = (workflow.nodes as Array<NodeShape & { parameters: { jsCode?: string } }>)
    .find(node => node.name === "Prepare Brief");
  assert.ok(prepare?.parameters.jsCode);
  const input = {
    jobId: "job-more", shop: "merchant.myshopify.com", topic: "Guide",
    callbackToken: "c".repeat(43), productCatalogHasMore: true,
    productCatalogSampledCount: 20, productCatalogMissingUrls: 0,
    productCatalog: Array.from({ length: 20 }, (_, i) => ({
      name: "Product " + i, description: "Simple product",
      url: "https://merchant.example/products/" + i
    })), brief: {}
  };
  const prepareInput = (body: unknown) => runInNewContext(
    "(() => {" + prepare.parameters.jsCode + "})()",
    { $input: { first: () => ({ json: { body } }) } }
  ) as Array<{ json: { user: string } }>;
  const result = prepareInput(input);
  const context = JSON.parse(result[0].json.user.split("brief: ")[1]);
  assert.equal(context.productCountSampled, 20);
  assert.equal(context.verifiedStoreProducts.length, 20);
  assert.equal(context.productSampleTruncated, true,
    "Shopify has more pages even though every sampled entry fits the prompt");
  assert.throws(() => prepareInput({ ...input, productCatalogHasMore: undefined }),
    /Missing or invalid Shopify catalog sample evidence/);
  assert.throws(() => prepareInput({ ...input, productCatalog: undefined }),
    /Missing or invalid Shopify catalog sample evidence/);
  const complete = JSON.parse(prepareInput({ ...input, productCatalogHasMore: false })[0].json.user.split("brief: ")[1]);
  assert.equal(complete.productSampleTruncated, false);
});


test("writer distinguishes no storefront URLs from a genuinely empty published catalog", () => {
  const workflow = load("n8n/shopify-blog-writer.json");
  const prepare = (workflow.nodes as Array<NodeShape & { parameters: { jsCode?: string } }>)
    .find(node => node.name === "Prepare Brief");
  assert.ok(prepare?.parameters.jsCode);
  const run = (body: Record<string, unknown>) => runInNewContext(
    "(() => {" + prepare.parameters.jsCode + "})()",
    { $input: { first: () => ({ json: { body } }) } }
  ) as Array<{ json: { user: string } }>;
  const base = {
    jobId: "job-null-urls", shop: "demo.myshopify.com", topic: "Care guide",
    callbackToken: "d".repeat(43), brief: {}, productCatalog: [],
    productCatalogHasMore: false, productCatalogSampledCount: 0,
    productCatalogMissingUrls: 0
  };
  const empty = JSON.parse(run(base)[0].json.user.split("brief: ")[1]);
  assert.equal(empty.shopifyRowsSampled, 0);
  assert.equal(empty.productsWithoutStorefrontUrl, 0);
  assert.equal(empty.productSampleTruncated, false);
  const noUrls = JSON.parse(run({ ...base, productCatalogSampledCount: 2,
    productCatalogMissingUrls: 2 })[0].json.user.split("brief: ")[1]);
  assert.equal(noUrls.shopifyRowsSampled, 2);
  assert.equal(noUrls.productsWithoutStorefrontUrl, 2);
  assert.equal(noUrls.productCountSampled, 0);
  assert.equal(noUrls.productSampleTruncated, true);
  assert.match(run({ ...base, productCatalogSampledCount: 2,
    productCatalogMissingUrls: 2 })[0].json.user, /productsWithoutStorefrontUrl/);
  assert.throws(() => run({ ...base, productCatalogSampledCount: 2,
    productCatalogMissingUrls: 0 }), /Inconsistent Shopify product sample counts/);
  assert.throws(() => run({ ...base, productCatalogSampledCount: -1 }),
    /Inconsistent Shopify product sample counts/);
});

test("writer and editor pass authentic model usage via the one-job callback, with absent usage left unknown",()=>{
  const workflow=load("n8n/shopify-blog-writer.json");
  const nodes=workflow.nodes as Array<NodeShape&{parameters:{jsCode?:string;jsonBody?:string}}>;
  const get=(name:string)=>{
    const n=nodes.find(n=>n.name===name);assert.ok(n);return n;
  };
  const prepared={jobId:"job1",shop:"sample.myshopify.com",callbackToken:"c".repeat(43)};
  const response=(stage:string)=>({
    id:"chatcmpl_"+stage+"_12345",model:"gpt-4.1-mini-2025-04-14",
    usage:{prompt_tokens:1500,completion_tokens:600},
    choices:[{finish_reason:"stop",message:{content:JSON.stringify({
      title:"A useful article",summary:"Practical summary",body:"<p>Content</p>"
    })}}]
  });
  const parseDraft=get("Parse Draft").parameters.jsCode!;
  const draft=runInNewContext("(() => {"+parseDraft+"})()",{
    $input:{first:()=>({json:response("writer")})},
    $:()=>({first:()=>({json:prepared})})
  }) as Array<{json:Record<string,unknown>}>;
  assert.equal((draft[0].json.writerUsage as any).inputTokens,1500);
  const parsed=runInNewContext("(() => {"+get("Parse Reviewed Article").parameters.jsCode+"})()",{
    $input:{first:()=>({json:response("editor")})},
    $:(name:string)=>({first:()=>({json:name==="Parse Draft"?draft[0].json:prepared})})
  }) as Array<{json:Record<string,unknown>}>;
  assert.equal((parsed[0].json.usage as any[]).length,2);
  assert.deepEqual((parsed[0].json.usage as any[]).map(x=>x.stage),["writer","editor"]);
  const expr=get("Return Secure Draft").parameters.jsonBody!;
  assert.ok(expr.startsWith("={{ ")&&expr.endsWith(" }}"));
  const payload=JSON.parse(runInNewContext(expr.slice(3,-3),{
    $json:parsed[0].json
  }) as string);
  assert.equal(payload.usage.length,2);
  assert.equal(payload.callbackToken,undefined);
  const missing=runInNewContext("(() => {"+parseDraft+"})()",{
    $input:{first:()=>({json:{choices:response("writer").choices}})},
    $:()=>({first:()=>({json:prepared})})
  }) as Array<{json:Record<string,unknown>}>;
  assert.equal(missing[0].json.writerUsage,null);
});
