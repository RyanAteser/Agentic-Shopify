import {test} from "node:test";
import assert from "node:assert/strict";
import {geminiBoundedProvider} from "../app/lib/swarm-gemini.server";
import {buildWorkerPrompt} from "../app/lib/swarm-execution-policy";

const env={
  SWARM_WORKER_ENABLED:"true",SWARM_ENABLE_PAID_MODEL_CALLS:"true",
  SWARM_GEMINI_MODEL:"gemini-3.8-flash",GEMINI_API_KEY:"t".repeat(40)
};
const prompt=buildWorkerPrompt({phase:"skeptic_verdict",title:"Find reliable search improvements",
  hypothesis:"Some nonbrand queries are not properly represented in the current product catalog.",
  metric:"Matched nonbrand clicks after controlled intervention.",
  rejectionRule:"Reject if confirmed adjusted effect is nonpositive.",
  specialty:"Independent source verification and contradiction hunting",prior:[]});
test("Gemini transport is fixed endpoint, one POST, structured output, metered usage",async()=>{
  let calls=0;
  const transport=(async(url:RequestInfo|URL,init?:RequestInit)=>{
    calls++;
    assert.equal(String(url),"https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent");
    assert.equal(init?.method,"POST");
    assert.equal(init?.redirect,"error");
    assert.equal((init?.headers as Record<string,string>)["x-goog-api-key"],env.GEMINI_API_KEY);
    const sent=JSON.parse(String(init?.body));
    assert.equal(sent.generationConfig.responseMimeType,"application/json");
    assert.equal(sent.generationConfig.maxOutputTokens,650);
    return new Response(JSON.stringify({
      candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({
        text:"A controlled research test is required before any commercial claims.",
        evidenceUrls:[],falsifier:"Reject if held-out results contradict the proposed mechanism.",
        verdict:"supported"
      })}]}}],
      usageMetadata:{promptTokenCount:120,candidatesTokenCount:42,thoughtsTokenCount:11}
    }),{status:200});
  }) as typeof fetch;
  const provider=geminiBoundedProvider(env,transport);
  const answer=await provider.generate(prompt);
  assert.equal(answer.verdict,"abstain","a model's unsupported supported verdict is never accepted");
  assert.equal(answer.inputTokens,120);
  assert.equal(answer.outputTokens,53);
  assert.equal(answer.model,"gemini-3.8-flash");
  assert.equal(calls,1);
});

test("network failures and missing usage are not silently retried or treated as free",async()=>{
  let calls=0;
  const broken=(async()=>{
    calls++;throw new Error("Network reply missing");
  }) as unknown as typeof fetch;
  await assert.rejects(geminiBoundedProvider(env,broken).generate(prompt),/uncertain/);
  assert.equal(calls,1);
  const noUsage=(async()=>new Response(JSON.stringify({
    candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({
      text:"Check source integrity before publishing.",
      evidenceUrls:[],falsifier:"Reject if evidence is missing",verdict:"abstain"
    })}]}}]
  }),{status:200})) as typeof fetch;
  await assert.rejects(geminiBoundedProvider(env,noUsage).generate(prompt),/usage/);
});

test("oversized provider body is rejected without saving model text",async()=>{
  const huge=(async()=>new Response("x".repeat(70000),{status:200})) as typeof fetch;
  await assert.rejects(geminiBoundedProvider(env,huge).generate(prompt),/size bound/);
});
