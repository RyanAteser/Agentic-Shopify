import {test} from "node:test";
import assert from "node:assert/strict";
import {compareFixedQueryMix} from "../app/lib/gsc-fixed-query-mix";

test("fixed baseline mix separates CTR improvement from adverse impression composition",()=>{
  const previous=Array.from({length:5},(_,i)=>({
    query:"q"+i,clicks:i===0?50:1,impressions:100
  }));
  const current=previous.map((r,i)=>({
    ...r,clicks:i===0?60:20,impressions:i===0?100:1000
  }));
  const result=compareFixedQueryMix(previous,current);
  assert.equal(result.status,"descriptive_only");
  if(result.status!=="descriptive_only")return;
  assert.ok(result.withinQueryEffect>0);
  assert.ok(result.mixEffect<0);
  assert.ok(result.currentCtr<result.previousCtr);
  assert.ok(Math.abs(result.withinQueryEffect+result.mixEffect-
    (result.currentCtr-result.previousCtr))<1e-12);
});

test("identical query distribution yields zero mix effect",()=>{
  const rows=Array.from({length:5},(_,i)=>({query:"q"+i,clicks:10,impressions:100}));
  const result=compareFixedQueryMix(rows,rows);
  assert.equal(result.status,"descriptive_only");
  if(result.status==="descriptive_only")assert.ok(Math.abs(result.mixEffect)<1e-12);
});

test("missing current exposure is unobservable, not a zero CTR",()=>{
  const rows=Array.from({length:5},(_,i)=>({query:"q"+i,clicks:10,impressions:100}));
  const current=rows.map((r,i)=>i===0?{...r,clicks:0,impressions:0}:r);
  assert.deepEqual(compareFixedQueryMix(rows,current),
    {status:"withheld",reason:"zero_current_exposure"});
});

test("reject duplicate rows and unsafe counts",()=>{
  const row={query:"q",clicks:1,impressions:100};
  assert.throws(()=>compareFixedQueryMix([row,row],[row]),/duplicate/);
  assert.throws(()=>compareFixedQueryMix([{...row,clicks:NaN}],[row]),/Invalid/);
  const huge=Array.from({length:5},(_,i)=>({query:"q"+i,clicks:0,impressions:Number.MAX_SAFE_INTEGER}));
  assert.throws(()=>compareFixedQueryMix(huge,huge),/Unsafe/);
});

test("withholds on sparse returning-query cohort",()=>{
  assert.equal(compareFixedQueryMix(
    [{query:"a",clicks:1,impressions:20}],
    [{query:"a",clicks:1,impressions:20}]).status,"withheld");
});
