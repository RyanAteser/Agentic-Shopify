import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
test("hourly scheduler is inert until configured", () => {
  const workflow = load("n8n/shopify-blog-scheduler.json");
  assert.equal(workflow.active, false);
  assert.ok(workflow.nodes.some(n => n.type.includes("scheduleTrigger")));
  const raw = readFileSync("n8n/shopify-blog-scheduler.json", "utf8");
  assert.ok(raw.includes("YOUR-PUBLISHED-SHOPIFY-APP.example"));
  assert.ok(raw.includes("httpHeaderAuth"));
});
