import {test} from "node:test";
import assert from "node:assert/strict";
import {compareQueryMix} from "../app/lib/gsc-query-mix";

test("aggregate CTR can fall while returning queries improve",()=>{
  const prev=Array.from({length:5},(_,i)=>({query:"product "+i,clicks:20,impressions:100}));
  const curr=prev.map(r=>({...r,clicks:25})).concat([
    {query:"broad discovery",clicks:1,impressions:2000}
  ]);
  const r=compareQueryMix(prev,curr);
  assert.equal(r.status,"descriptive_only");
  assert.equal(r.matchedQueries,5);
  assert.equal(r.newQueries,1);
  assert.equal(r.lostQueries,0);
  assert.ok(r.matchedCurrentCtr!>r.matchedPreviousCtr!);
  assert.ok(r.totalCurrentCtr!<r.totalPreviousCtr!);
});
test("matched-query diagnostic abstains on sparse cohorts",()=>{
  const r=compareQueryMix([{query:"a",clicks:1,impressions:10}],
    [{query:"a",clicks:2,impressions:10}]);
  assert.equal(r.status,"insufficient_coverage");
});
test("query rows reject duplicate, invalid and unsafe totals",()=>{
  const good=[{query:"x",clicks:1,impressions:2}];
  for(const bad of [
    [...good,...good], [{query:"",clicks:1,impressions:2}],
    [{query:"x",clicks:3,impressions:2}],
    [{query:"x",clicks:NaN,impressions:2}],
    [{query:"x",clicks:-1,impressions:2}]
  ])assert.throws(()=>compareQueryMix(bad,good));
  assert.throws(()=>compareQueryMix([
    {query:"x",clicks:0,impressions:Number.MAX_SAFE_INTEGER},
    {query:"y",clicks:0,impressions:1}
  ],good),/Unsafe aggregate/);
});
test("missing query is not a zero-impression observation",()=>{
  const r=compareQueryMix([{query:"lost",clicks:2,impressions:20}],[]);
  assert.equal(r.lostQueries,1);
  assert.equal(r.matchedPreviousCtr,null);
  assert.equal(r.totalCurrentCtr,null);
});
