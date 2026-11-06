import type {BoundedModelProvider,BoundedModelRequest,BoundedModelAnswer} from "./swarm-execution-policy";
import {
  PILOT_MAX_OUTPUT_CHARS,PILOT_TIMEOUT_MS,parseWorkerText,validateModelUsage
} from "./swarm-execution-policy";
import {SwarmPolicyError} from "./swarm-policy";

/** Fixed endpoint; no browsing/tool execution and no caller-controlled URLs. */
const GEMINI_ENDPOINT="https://generativelanguage.googleapis.com/v1beta/models/";
const PERMITTED_MODELS=new Set(["gemini-3.8-flash","gemini-2.5-flash-lite"]);

type GeminiResponse={
  candidates?:{finishReason?:string;content?:{parts?:{text?:string}[]}}[];
  usageMetadata?:{promptTokenCount?:number;candidatesTokenCount?:number;thoughtsTokenCount?:number};
  modelVersion?:string;
};

function validatedKey(env:Record<string,string|undefined>){
  const key=env.GEMINI_API_KEY;
  if(!key||key.length<20||key.trim()!==key)throw new SwarmPolicyError(
    "Gemini API key is not configured for the bounded worker.",503);
  return key;
}

/** Read no more than 64 KiB from the provider response. */
async function readBoundedJson(response:Response):Promise<unknown>{
  const reader=response.body?.getReader();
  if(!reader)throw new SwarmPolicyError("Provider returned no response body.",502);
  const chunks:Uint8Array[]=[];let total=0;
  try{
    while(true){
      const {value,done}=await reader.read();
      if(done)break;
      total+=value.byteLength;
      if(total>65536)throw new SwarmPolicyError("Provider response exceeded size bound.",502);
      chunks.push(value);
    }
  }finally{await reader.cancel().catch(()=>{});}
  try{
    const whole=new Uint8Array(total);let offset=0;
    for(const c of chunks){whole.set(c,offset);offset+=c.byteLength;}
    return JSON.parse(new TextDecoder().decode(whole));
  }catch{throw new SwarmPolicyError("Provider returned invalid JSON.",502);}
}

export function geminiBoundedProvider(
  env:Record<string,string|undefined>=process.env,
  transport:typeof fetch=fetch
):BoundedModelProvider{
  const model=env.SWARM_GEMINI_MODEL;
  if(!model||!PERMITTED_MODELS.has(model))throw new SwarmPolicyError(
    "Worker requires an explicit allowed SWARM_GEMINI_MODEL.",503);
  if(env.SWARM_ENABLE_PAID_MODEL_CALLS!=="true"||env.SWARM_WORKER_ENABLED!=="true"){
    throw new SwarmPolicyError("External model calls require explicit owner opt-in.",403);
  }
  const apiKey=validatedKey(env);
  return {providerName:"gemini-generate-content",modelName:model,
    async generate(request:BoundedModelRequest):Promise<BoundedModelAnswer>{
      const json={
        systemInstruction:{parts:[{text:request.system}]},
        contents:[{role:"user",parts:[{text:request.prompt}]}],
        generationConfig:{
          responseMimeType:"application/json",
          maxOutputTokens:request.maxOutputTokens,
          temperature:0.35
        }
      };
      let response:Response;
      try{
        response=await transport(GEMINI_ENDPOINT+model+":generateContent",{
          method:"POST",redirect:"error",cache:"no-store",
          headers:{"x-goog-api-key":apiKey,"Content-Type":"application/json"},
          body:JSON.stringify(json),
          signal:AbortSignal.timeout(PILOT_TIMEOUT_MS)
        });
      }catch{
        // A timeout or dropped response does NOT prove the API didn't bill.
        throw new SwarmPolicyError("Provider outcome uncertain; do not automatically retry.",502);
      }
      if(!response.ok)throw new SwarmPolicyError(
        "Provider call failed or may have been charged; do not automatically retry.",502);
      const parsed=await readBoundedJson(response) as GeminiResponse;
      const candidate=parsed.candidates?.[0];
      if(candidate?.finishReason!=="STOP")throw new SwarmPolicyError(
        "Provider did not complete a usable output.",502);
      const raw=candidate.content?.parts?.map(x=>x.text??"").join("")??"";
      if(!raw||raw.length>6000)throw new SwarmPolicyError(
        "Provider produced empty or oversized output.",502);
      let data:Record<string,unknown>;
      try{
        const obj:unknown=JSON.parse(raw);
        if(!obj||typeof obj!=="object"||Array.isArray(obj))throw new Error();
        data=obj as Record<string,unknown>;
      }catch{throw new SwarmPolicyError("Provider output was not valid structured JSON.",502);}
      const result=parseWorkerText(data.text,data.evidenceUrls,data.falsifier,data.verdict,request.phase);
      const count=parsed.usageMetadata??{};
      const usage:BoundedModelAnswer={
        ...result,inputTokens:count.promptTokenCount??-1,
        // Candidate + reported thinking tokens are conservatively metered.
        outputTokens:(count.candidatesTokenCount??-1)+(count.thoughtsTokenCount??0),
        model
      };
      validateModelUsage(usage,model);
      if(usage.text.length>PILOT_MAX_OUTPUT_CHARS)throw new SwarmPolicyError(
        "Worker output over hard limit.",502);
      return usage;
    }
  };
}
