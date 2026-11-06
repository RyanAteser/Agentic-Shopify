import {test} from "node:test";
import assert from "node:assert/strict";
import {resolveSwarmEntitlement} from "../app/lib/swarm-billing.server";

test("billing adapter does not query Shopify or grant paid slots while billing is disabled",async()=>{
  let calls=0;
  const admin={graphql:async()=>{calls++;return {json:async()=>({})}}};
  assert.equal(await resolveSwarmEntitlement(admin,{}),"free");
  assert.equal(await resolveSwarmEntitlement(admin,{SWARM_BILLING_ENABLED:"false"}),"free");
  assert.equal(calls,0);
});

test("subscription claims are accepted only after an active app-scoped Shopify API response",async()=>{
  const admin={graphql:async(query:string)=>{
    assert.match(query,/currentAppInstallation/);
    assert.match(query,/activeSubscriptions/);
    return {json:async()=>({data:{currentAppInstallation:{activeSubscriptions:[
      {id:"gid://shopify/AppSubscription/123",name:"Agentic Swarm Growth",status:"ACTIVE"}
    ]}}})};
  }};
  assert.equal(await resolveSwarmEntitlement(admin,{SWARM_BILLING_ENABLED:"true"}),"growth");
  const broken={graphql:async()=>{throw new Error("Shopify unavailable")}};
  assert.equal(await resolveSwarmEntitlement(broken,{SWARM_BILLING_ENABLED:"true"}),"free");
  const partial={graphql:async()=>({json:async()=>({data:{currentAppInstallation:{}}})})};
  assert.equal(await resolveSwarmEntitlement(partial,{SWARM_BILLING_ENABLED:"true"}),"free");
  const errors={graphql:async()=>({json:async()=>({data:{currentAppInstallation:{
    activeSubscriptions:[{id:"gid://shopify/AppSubscription/123",name:"Agentic Swarm Scale",status:"ACTIVE"}]
  }},errors:[{message:"stale"}]})})};
  assert.equal(await resolveSwarmEntitlement(errors,{SWARM_BILLING_ENABLED:"true"}),"free");
});
