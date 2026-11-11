import {test} from "node:test";
import assert from "node:assert/strict";
import {laneFor,SWARM_LANES,SKEPTIC_LANES} from "../app/lib/swarm-lanes";
import {AGENTS} from "../app/lib/agent-registry";

test("all declared roles have distinct initial research lanes",()=>{
  for(const role of AGENTS){
    assert.ok(SWARM_LANES[role.id]?.length>=4,role.id);
    const initial=Array.from({length:Math.min(4,SWARM_LANES[role.id].length)},(_,i)=>
      laneFor(role.id,i,"specialist"));
    assert.equal(new Set(initial).size,initial.length,role.id);
  }
  const seo=Array.from({length:6},(_,i)=>laneFor("seo",i,"specialist"));
  assert.equal(new Set(seo).size,6);
  const blog=Array.from({length:2},(_,i)=>laneFor("content",i,"specialist"));
  assert.equal(new Set(blog).size,2);
  const skeptics=Array.from({length:2},(_,i)=>laneFor("seo",i,"skeptic"));
  assert.equal(new Set(skeptics).size,2);
  assert.equal(SKEPTIC_LANES.length,5);
});

test("over-capacity assignments cycle visibly instead of silently duplicating instructions",()=>{
  assert.match(laneFor("seo",SWARM_LANES.seo.length,"specialist"),/independent pass 2/);
  assert.match(laneFor("seo",SKEPTIC_LANES.length,"skeptic"),/independent pass 2/);
  for(const index of [-1,1.5,Number.MAX_SAFE_INTEGER]){
    assert.throws(()=>laneFor("seo",index,"specialist"));
  }
  assert.throws(()=>laneFor("unknown",0,"specialist"));
});
