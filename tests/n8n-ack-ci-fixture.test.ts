import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {readFileSync,mkdtempSync,rmSync,readdirSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";
import {runInNewContext} from "node:vm";

test("real-n8n CI fixture contains only the original safe first three workflow nodes",()=>{
  const scratch=mkdtempSync(join(tmpdir(),"n8n-ack-only-"));
  try{
    const original="n8n/shopify-blog-writer.json";
    const untouched=readFileSync(original,"utf8");
    const out=join(scratch,"ci-only.json");
    execFileSync(process.execPath,[
      "scripts/make-n8n-ack-fixture.mjs",original,out
    ],{timeout:10000,stdio:"pipe"});
    const f=JSON.parse(readFileSync(out,"utf8"));
    assert.equal(f.active,false);
    assert.equal(f.id,"ci-ack-only-v1");
    assert.deepEqual(f.nodes.map((n:{name:string})=>n.name),[
      "Receive Draft Request","Prepare Brief","Acknowledge Job Acceptance"
    ]);
    assert.deepEqual(f.nodes.map((n:{type:string})=>n.type),[
      "n8n-nodes-base.webhook","n8n-nodes-base.code",
      "n8n-nodes-base.respondToWebhook"
    ]);
    assert.equal(f.nodes[0].parameters.authentication,"none",
      "Only CI's isolated copy may bypass production header authentication");
    const originalWorkflow=JSON.parse(untouched);
    assert.equal(originalWorkflow.nodes[0].parameters.authentication,"headerAuth");
    assert.equal(f.nodes[0].parameters.path,"ci-only-blog-ack");
    assert.equal(f.nodes[2].parameters.options.responseCode,202);
    assert.equal(Object.keys(f.connections).length,2);
    assert.equal(f.connections["Prepare Brief"].main[0][0].node,
      "Acknowledge Job Acceptance");
    assert.equal("Acknowledge Job Acceptance" in f.connections,false);
    assert.equal(f.nodes.some((n:{type:string})=>n.type.includes("httpRequest")),false);
    assert.equal(f.nodes.some((n:{credentials?:unknown})=>n.credentials!==undefined),false);
    const response=f.nodes[2].parameters.responseBody as string;
    assert.ok(response.startsWith("={{ ")&&response.endsWith(" }}"));
    const reply=runInNewContext(response.slice(3,-3),{
      $json:{jobId:"ci-job",shop:"ci-only.myshopify.com"}
    }) as string;
    assert.deepEqual(JSON.parse(reply),{
      accepted:true,jobId:"ci-job",shop:"ci-only.myshopify.com"
    });
    assert.equal(readFileSync(original,"utf8"),untouched);
    assert.equal(readdirSync(scratch).length,1);
  }finally{rmSync(scratch,{recursive:true,force:true});}
});
