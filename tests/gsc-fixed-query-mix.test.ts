import {test} from "node:test";
import assert from "node:assert/strict";
import {compareFixedQueryMix, assessFixedQueryMix} from "../app/lib/gsc-fixed-query-mix";

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


test("safe fixed-mix entry point returns effects only after property coverage checks",()=>{
  const rows=Array.from({length:5},(_,i)=>({query:"q"+i,clicks:10,impressions:100}));
  const total={clicks:50,impressions:500};
  const result=assessFixedQueryMix(rows,rows,total,total);
  assert.equal(result.status,"descriptive_only");
  if(result.status==="descriptive_only")assert.equal(result.mixEffect,0);
});

test("safe entry point withholds effects when independently observed exports are incomplete",()=>{
  const rows=Array.from({length:5},(_,i)=>({query:"q"+i,clicks:10,impressions:100}));
  const total={clicks:100,impressions:1000};
  assert.deepEqual(assessFixedQueryMix(rows,rows,total,total),
    {status:"withheld",reason:"export_coverage"});
});

test("safe entry point withholds effects when matched clicks cover too little traffic",()=>{
  const previous=Array.from({length:5},(_,i)=>({query:"q"+i,clicks:1,impressions:100}));
  const current=[...previous,{query:"new",clicks:95,impressions:100}];
  const pTotal={clicks:5,impressions:500},cTotal={clicks:100,impressions:600};
  assert.deepEqual(assessFixedQueryMix(previous,current,pTotal,cTotal),
    {status:"withheld",reason:"matched_cohort"});
});

test("safe entry point withholds zero current exposure despite passing cohort coverage",()=>{
  const previous=Array.from({length:6},(_,i)=>({query:"q"+i,clicks:10,impressions:100}));
  const current=previous.map((r,i)=>i===0?{...r,clicks:0,impressions:0}:r);
  const result=assessFixedQueryMix(previous,current,
    {clicks:60,impressions:600},{clicks:50,impressions:500});
  assert.deepEqual(result,{status:"withheld",reason:"zero_current_exposure"});
});
