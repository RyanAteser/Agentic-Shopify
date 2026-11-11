import {test} from "node:test";
import assert from "node:assert/strict";
import {geminiBoundedProvider,SwarmProviderError} from "../app/lib/swarm-gemini.server";
import {buildWorkerPrompt,parseWorkerText} from "../app/lib/swarm-execution-policy";

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
    assert.equal(sent.generationConfig.responseMimeType,"application/json");
    assert.equal(sent.generationConfig.responseJsonSchema.type,"object");
    assert.deepEqual(sent.generationConfig.responseJsonSchema.required,
      ["text","evidenceUrls","falsifier","verdict"]);
    assert.deepEqual(sent.generationConfig.responseJsonSchema.properties.verdict.enum,
      ["supported","rejected","abstain"]);
    assert.equal(sent.generationConfig.thinkingConfig.thinkingLevel,"low");
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

test("HTTP rejection and thinking-token truncation produce sanitized categories",async()=>{
  const httpRejected=(async()=>new Response(
    "{\"error\":{\"message\":\"sensitive provider details must not be persisted\"}}",
    {status:403})) as typeof fetch;
  await assert.rejects(
    geminiBoundedProvider(env,httpRejected).generate(prompt),
    (error:unknown)=>error instanceof SwarmProviderError &&
      error.diagnosticCode==="GEMINI_HTTP_403" &&
      !error.message.includes("sensitive provider")
  );
  const truncated=(async()=>new Response(JSON.stringify({
    candidates:[{finishReason:"MAX_TOKENS",content:{parts:[]}}],
    usageMetadata:{promptTokenCount:580,candidatesTokenCount:0,thoughtsTokenCount:650}
  }),{status:200})) as typeof fetch;
  await assert.rejects(
    geminiBoundedProvider(env,truncated).generate(prompt),
    (error:unknown)=>error instanceof SwarmProviderError &&
      error.diagnosticCode==="GEMINI_FINISH_MAX_TOKENS"
  );
});

test("Gemini schema-policy violations have a safe diagnostic code without user text",async()=>{
  const bad=(async()=>new Response(JSON.stringify({
    candidates:[{finishReason:"STOP",content:{parts:[{text:JSON.stringify({
      text:"bad",evidenceUrls:[],falsifier:"too short",verdict:"abstain"
    })}]}}],
    usageMetadata:{promptTokenCount:10,candidatesTokenCount:11}
  }),{status:200})) as typeof fetch;
  await assert.rejects(
    geminiBoundedProvider(env,bad).generate(prompt),
    (e:unknown)=>e instanceof SwarmProviderError &&
      e.diagnosticCode==="GEMINI_SCHEMA_POLICY_MISMATCH" &&
      !e.message.includes("bad")
  );
});

test("provider source-field references are typed and malformed values fail validation",()=>{
  const valid=parseWorkerText("ANSWER: YES\nSource-backed result is true.",[],
    "Reject if authenticated field changes.",undefined,"independent_hypothesis",
    {field:"storefrontPasswordEnabled",value:"true"});
  assert.equal(valid.sourceFact?.field,"storefrontPasswordEnabled");
  assert.equal(valid.sourceFact?.value,"true");
  assert.throws(()=>parseWorkerText("ANSWER: YES\nSource-backed result is true.",[],
    "Reject if authenticated field changes.",undefined,"independent_hypothesis",
    {field:"untrustedGoogleRanking",value:"1"}),/malformed/);
  assert.throws(()=>parseWorkerText("ANSWER: YES\nSource-backed result is true.",[],
    "Reject if authenticated field changes.",undefined,"independent_hypothesis",
    {field:"storefrontPasswordEnabled",value:"true",danger:"injected"}),/malformed/);
});
