import {createHash} from "node:crypto";

/**
 * Source is an authenticated n8n job callback, NOT the OpenAI invoice.
 * Reject invalid or duplicate stages before writing the completed article.
 * Missing usage remains missing; never convert it to zero.
 */
export type BlogUsageStage="writer"|"editor";
export type BlogUsageReceipt={
  stage:BlogUsageStage;model:string;inputTokens:number;outputTokens:number;
  responseIdHash:string|null;
};
export class InvalidBlogUsageError extends Error {
  constructor(){super("Invalid blog model usage report");this.name="InvalidBlogUsageError";}
}
export function hashOpenAiResponseId(responseId:string):string {
  if(typeof responseId!=="string"||!/^[A-Za-z0-9_-]{8,128}$/.test(responseId))
    throw new InvalidBlogUsageError();
  // Keep the established purpose-separated hash compatible with stored receipts.
  return createHash("sha256").update("openai-request:v1\0")
    .update(responseId).digest("hex");
}
export function parseBlogUsage(raw:unknown):BlogUsageReceipt[]{
  if(raw===undefined||raw===null)return [];
  if(!Array.isArray(raw)||raw.length>2)throw new InvalidBlogUsageError();
  const stages=new Set<string>();
  const receipts:BlogUsageReceipt[]=[];
  for(const item of raw){
    if(!item||typeof item!=="object"||Array.isArray(item))throw new InvalidBlogUsageError();
    const r=item as Record<string,unknown>;
    const stage=r.stage;
    if((stage!=="writer"&&stage!=="editor")||stages.has(stage))throw new InvalidBlogUsageError();
    stages.add(stage);
    const model=r.model;
    // The current writer and editor n8n nodes are pinned to gpt-4.1-mini.
    // A changed workflow/model needs a deliberate versioned schema update.
    if(typeof model!=="string"||!/^gpt-4\.1-mini(?:-\d{4}-\d{2}-\d{2})?$/.test(model))
      throw new InvalidBlogUsageError();
    const inputTokens=r.inputTokens,outputTokens=r.outputTokens;
    if(typeof inputTokens!=="number"||!Number.isSafeInteger(inputTokens)||inputTokens<1||
       inputTokens>1_000_000||typeof outputTokens!=="number"||!Number.isSafeInteger(outputTokens)||
       outputTokens<1||outputTokens>3000)throw new InvalidBlogUsageError();
    const id=r.responseId;
    if(id!==undefined&&id!==null&&
       (typeof id!=="string"||!/^[A-Za-z0-9_-]{8,128}$/.test(id)))
      throw new InvalidBlogUsageError();
    const responseIdHash=typeof id==="string"?hashOpenAiResponseId(id):null;
    receipts.push({stage,model,inputTokens,outputTokens,responseIdHash});
  }
  return receipts;
}
