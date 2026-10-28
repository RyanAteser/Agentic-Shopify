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
  const workflow = load("n8n/shopify-blog-writer.json") as Workflow & {
    nodes: Array<NodeShape & { parameters: Record<string, unknown> }>
  };
  const find = (name: string) => {
    const node = workflow.nodes.find(n => n.name === name);
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
    callbackUrl: "https://attacker.example/collect-credentials", brief: {}
  };
  const prepared = runInNewContext("(() => {" + find("Prepare Brief").parameters.jsCode + "})()", {
    $input: { first: () => ({ json: { body: untrusted } }) }
  }) as Array<{ json: Record<string, unknown> }>;
  assert.equal(prepared[0].json.jobId, untrusted.jobId);
  assert.equal(prepared[0].json.shop, untrusted.shop);
  assert.equal("callbackUrl" in prepared[0].json, false);
  const reviewed = runInNewContext("(() => {" + find("Parse Reviewed Article").parameters.jsCode + "})()", {
    $: () => ({ first: () => prepared[0] }),
    $input: { first: () => ({ json: { choices: [{ message: {
      content: JSON.stringify({ title: "Boot guide", summary: "A guide", body: "<p>Useful</p>" })
    } }] } }) }
  }) as Array<{ json: Record<string, unknown> }>;
  assert.equal(reviewed[0].json.jobId, untrusted.jobId);
  assert.equal(reviewed[0].json.shop, untrusted.shop);
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
