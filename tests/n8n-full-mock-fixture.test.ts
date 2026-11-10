import {test} from "node:test";
import assert from "node:assert/strict";
import {execFileSync} from "node:child_process";
import {mkdtempSync,readFileSync,rmSync,writeFileSync} from "node:fs";
import {tmpdir} from "node:os";
import {join} from "node:path";

const source="n8n/shopify-blog-writer.json";
function fixture(change?:(data:any)=>void,credentialed=false){
  const scratch=mkdtempSync(join(tmpdir(),"ci-n8n-full-"));
  try{
    const original=JSON.parse(readFileSync(source,"utf8"));
    const input=join(scratch,"source.json");
    if(change)change(original);
    writeFileSync(input,JSON.stringify(original));
    const output=join(scratch,"fixture.json");
    execFileSync(process.execPath,[
      "scripts/make-n8n-full-fixture.mjs",input,output,
      ...(credentialed?["--credentialed-webhook"]:[])
    ],{timeout:10000,stdio:"pipe"});
    return JSON.parse(readFileSync(output,"utf8"));
  }finally{rmSync(scratch,{recursive:true,force:true});}
}
test("full real-engine fixture uses all original workflow nodes but routes every HTTP call internally",()=>{
  const original=JSON.parse(readFileSync(source,"utf8"));
  const f=fixture();
  assert.equal(f.active,false);
  assert.equal(f.id,"ci-blog-full-loop-v1");
  assert.equal(f.nodes.length,8);
  assert.deepEqual(f.nodes.map((n:any)=>n.name),original.nodes.map((n:any)=>n.name));
  assert.deepEqual(f.nodes.map((n:any)=>n.type),original.nodes.map((n:any)=>n.type));
  assert.deepEqual(f.connections,original.connections);
  assert.equal(f.nodes[0].parameters.authentication,"none");
  assert.equal(original.nodes[0].parameters.authentication,"headerAuth");
  assert.equal(f.nodes[0].webhookId,original.nodes[0].webhookId);
  const http=f.nodes.filter((n:any)=>n.type==="n8n-nodes-base.httpRequest");
  assert.equal(http.length,3);
  assert.ok(http.every((n:any)=>n.parameters.url.startsWith("http://ci-n8n-mock:8080/")));
  assert.ok(http.every((n:any)=>!n.credentials));
  assert.equal(http.filter((n:any)=>n.parameters.url.endsWith("chat/completions")).length,2);
  assert.equal(http.filter((n:any)=>n.parameters.url.endsWith("api/agent/complete")).length,1);
  assert.ok(!JSON.stringify(f).includes("api.openai.com"));
  assert.ok(!JSON.stringify(f).includes("YOUR-PUBLISHED-SHOPIFY-APP"));
  assert.equal(f.nodes.find((n:any)=>n.name==="Return Secure Draft")
    .parameters.headerParameters.parameters[0].value,"={{ $json.callbackToken }}");
  assert.equal(original.active,false,"Source workflow must remain inactive");
});
test("full mock fixture refuses changed LLM URLs, additional nodes or credential metadata",()=>{
  assert.throws(()=>fixture(x=>{x.nodes.find((n:any)=>n.name==="Draft Article")
    .parameters.url="https://attacker.example/collect";}),
    /Source LLM API contract changed/);
  assert.throws(()=>fixture(x=>{x.nodes.push({
    name:"Unexpected HTTP",type:"n8n-nodes-base.httpRequest"
  });}),/topology changed/);
  assert.throws(()=>fixture(x=>{x.nodes.find((n:any)=>n.name==="Draft Article")
    .credentials={httpHeaderAuth:{id:"sample"}};}),/credentials/);
});
test("full mock fixture refuses a different webhook path, inactive policy or callback header",()=>{
  assert.throws(()=>fixture(x=>{x.active=true;}),/INACTIVE/);
  assert.throws(()=>fixture(x=>{x.nodes[0].parameters.authentication="none";}),
    /Production webhook specification changed/);
  assert.throws(()=>fixture(x=>{x.nodes[0].webhookId=undefined;}),
    /Production webhook specification changed/);
  assert.throws(()=>fixture(x=>{x.nodes.find((n:any)=>n.name==="Return Secure Draft")
    .parameters.headerParameters.parameters[0].name="Authorization";}),
    /Source callback capability contract changed/);
});

test("real inbound headerAuth fixture references ephemeral n8n credential without storing its value",()=>{
  const sourceData=JSON.parse(readFileSync(source,"utf8"));
  const f=fixture(undefined,true);
  const hook=f.nodes.find((n:any)=>n.name==="Receive Draft Request");
  assert.equal(hook.parameters.authentication,"headerAuth");
  assert.equal(hook.parameters.path,"ci-only-blog-full");
  assert.deepEqual(hook.credentials,{
    httpHeaderAuth:{id:"ci-inbound-header-v1",name:"CI ONLY inbound header auth"}
  });
  assert.equal(f.nodes.filter((n:any)=>n.credentials!==undefined).length,1);
  assert.equal(sourceData.nodes[0].parameters.authentication,"headerAuth");
  assert.equal(sourceData.nodes[0].credentials,undefined);
  assert.ok(!JSON.stringify(f).includes("X-Agent-Key:"));
  assert.ok(f.nodes.every((n:any)=>!n.credentials||
    n.name==="Receive Draft Request"));
});
test("fixture rejects invented auth flags and never adds real provider credentials",()=>{
  const d=mkdtempSync(join(tmpdir(),"ci-n8n-invalid-mode-"));
  try{
    const input=join(d,"input.json"),output=join(d,"output.json");
    writeFileSync(input,readFileSync(source,"utf8"));
    assert.throws(()=>execFileSync(process.execPath,[
      "scripts/make-n8n-full-fixture.mjs",input,output,"--disable-security"
    ],{timeout:10000,stdio:"pipe"}));
  }finally{rmSync(d,{recursive:true,force:true});}
});
