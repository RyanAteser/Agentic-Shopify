#!/usr/bin/env node
/**
 * Disposable local CI-only replacement for OpenAI and the Shopify callback.
 * No credentials, model access, network egress, merchant writes or billing.
 */
import {createServer} from "node:http";
const HOST="0.0.0.0", PORT=8080;
const state={writerRequests:0,editorRequests:0,callbacks:0,
  validCallbacks:0,rejectedCalls:0,failedEditorResponses:0,
  lastCallback:null,modelPolicyViolations:0};

function reply(res,status,obj){
  const body=JSON.stringify(obj);
  res.writeHead(status,{"Content-Type":"application/json",
    "Cache-Control":"no-store","Content-Length":Buffer.byteLength(body)});
  res.end(body);
}
async function parse(req){
  let bytes=0;const chunks=[];
  for await(const chunk of req){
    bytes+=chunk.length;
    if(bytes>64000)throw new Error("request_too_large");
    chunks.push(chunk);
  }
  const obj=JSON.parse(Buffer.concat(chunks).toString("utf8"));
  if(!obj||typeof obj!=="object"||Array.isArray(obj))
    throw new Error("invalid_payload");
  return obj;
}
const article={
  title:"A synthetic product guide",
  summary:"Testing a synthetic workflow without factual product claims.",
  body:"<h2>Test-only article</h2><p>This is test text from an offline fixture and is not intended for publication.</p>",
  keyword:"synthetic guide",
  tags:["offline"]
};
createServer(async(req,res)=>{
  try{
    if(req.method==="GET"&&req.url==="/healthz"){
      reply(res,200,{ready:true});return;
    }
    if(req.method==="GET"&&req.url==="/state"){
      reply(res,200,state);return;
    }
    if(req.method!=="POST"){
      reply(res,404,{error:"not_found"});return;
    }
    if(req.url==="/v1/chat/completions"){
      const input=await parse(req);
      const sys=input.messages?.[0]?.content;
      const user=input.messages?.[1]?.content;
      if(input.model!=="gpt-4.1-mini"||input.max_completion_tokens!==3000||
         input.response_format?.type!=="json_object"||
         (input.n??1)!==1||typeof sys!=="string"||
         typeof user!=="string"||sys.length>15000||user.length>30000){
        state.modelPolicyViolations++;
        reply(res,422,{error:"bad_mock_model_policy"});return;
      }
      let stage;
      if(sys.includes("You are a careful ecommerce editor"))stage="writer";
      else if(sys.includes("You are a strict ecommerce managing editor"))stage="editor";
      else{
        state.modelPolicyViolations++;
        reply(res,422,{error:"unrecognized_mock_stage"});return;
      }
      if(stage==="writer")state.writerRequests++;
      else state.editorRequests++;
      const failed=stage==="editor"&&user.includes("FAIL_EDITOR");
      if(failed)state.failedEditorResponses++;
      reply(res,200,{
        id:stage==="writer"?"chatcmpl_mock_writer_001":"chatcmpl_mock_editor_001",
        model:"gpt-4.1-mini-2025-04-14",
        choices:[{index:0,finish_reason:failed?"length":"stop",
          message:{role:"assistant",content:JSON.stringify(article)}}],
        usage:{prompt_tokens:stage==="writer"?900:1300,
          completion_tokens:stage==="writer"?350:450,total_tokens:stage==="writer"?1250:1750}
      });
      return;
    }
    if(req.url==="/api/agent/complete"){
      state.callbacks++;
      const body=await parse(req);
      const usages=body.usage;
      const expected=(
        typeof body.jobId==="string"&&/^ci-full-/.test(body.jobId)&&
        body.shop==="ci-only.myshopify.com"&&
        req.headers["x-agent-key"]==="a".repeat(43)&&
        body.article?.title===article.title&&body.article?.body===article.body&&
        Array.isArray(usages)&&usages.length===2&&
        usages[0]?.stage==="writer"&&usages[1]?.stage==="editor"&&
        usages.every(x=>x.model==="gpt-4.1-mini-2025-04-14"&&
          Number.isSafeInteger(x.inputTokens)&&x.inputTokens>0&&
          Number.isSafeInteger(x.outputTokens)&&x.outputTokens>0&&
          /^chatcmpl_mock_/.test(x.responseId))
      );
      if(!expected){
        state.rejectedCalls++;
        reply(res,422,{error:"callback_contract_invalid"});return;
      }
      state.validCallbacks++;
      // Never retain raw article body, credentials or entire model payload.
      state.lastCallback={jobId:body.jobId,shop:body.shop,
        usageStages:usages.map(u=>u.stage),
        tokens:usages.map(u=>[u.inputTokens,u.outputTokens])};
      reply(res,200,{draftId:"ci-only-draft",score:75});
      return;
    }
    reply(res,404,{error:"not_found"});
  }catch{
    state.rejectedCalls++;
    reply(res,400,{error:"malformed_mock_request"});
  }
}).listen(PORT,HOST,()=>console.log("CI offline fake model/callback server ready"));
