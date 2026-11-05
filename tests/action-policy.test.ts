import { test } from "node:test";
import assert from "node:assert/strict";
import { AGENTS } from "../app/lib/agent-registry";
import { canExecuteAction, ACTION_POLICY } from "../app/lib/action-policy";

test("agent registry has stable unique IDs and no misleading active status",()=>{
  assert.ok(AGENTS.length >= 8);
  assert.equal(AGENTS.length,new Set(AGENTS.map(a=>a.id)).size);
  assert.ok(AGENTS.every(a=>["prototype","in_development","planned"].includes(a.status)));
});
test("policy is default-deny and never allows high risk mutation without human approval",()=>{
  assert.equal(canExecuteAction("unknown.action"),false);
  assert.equal(canExecuteAction("content.article.publish",{automationEnabled:true}),false);
  assert.equal(canExecuteAction("content.article.publish",{humanApproved:true}),true);
  assert.equal(canExecuteAction("theme.code.deploy",{humanApproved:true}),false);
  assert.equal(canExecuteAction("ads.budget.change",{automationEnabled:true}),false);
  assert.equal(canExecuteAction("seo.rank.read"),true);
  assert.equal(canExecuteAction("content.article.draft",{automationEnabled:true}),true);
  assert.equal(ACTION_POLICY["pricing.change"],"approval_required");
});
