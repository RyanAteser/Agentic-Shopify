import {test} from "node:test";
import assert from "node:assert/strict";
import {assessGscRankEvidence} from "../app/lib/gsc-rank-evidence";

const now=new Date("2026-10-28T12:00:00Z");
const page="https://shop.example/products/boots";
const dates=Array.from({length:15},(_,i)=>
  new Date(Date.UTC(2026,9,3+i)).toISOString().slice(0,10));
const evidence=()=>({
  primaryHost:"shop.example",
  incident:{keyword:"winter boots",targetUrl:page,country:"usa",device:"DESKTOP",
    engine:"google",observedAt:"2026-10-10T12:00:00Z"},
  request:{
    siteUrl:"https://shop.example/",startDate:"2026-10-03",endDate:"2026-10-17",
    dimensions:["date"],type:"web",dataState:"final",aggregationType:"auto",
    rowLimit:1000,startRow:0,
    dimensionFilterGroups:[{groupType:"and",filters:[
      {dimension:"query",operator:"equals",expression:"winter boots"},
      {dimension:"page",operator:"equals",expression:page},
      {dimension:"country",operator:"equals",expression:"usa"},
      {dimension:"device",operator:"equals",expression:"DESKTOP"}
    ]}]
  },
  response:{responseAggregationType:"byPage",rows:dates.map((date,i)=>({
    keys:[date],clicks:i<7?10:i===7?8:5,impressions:100,
    ctr:i<7?0.1:i===7?0.08:0.05,position:i<7?3:i===7?4:6
  }))}
});

test("compares seven Pacific days before and after, excluding the incident date",()=>{
  const report=assessGscRankEvidence(evidence(),now);
  assert.equal(report.incidentPacificDate,"2026-10-10");
  assert.equal(report.completeDateCoverage,true);
  assert.equal(report.baseline.days,7);
  assert.equal(report.followup.days,7);
  assert.equal(report.baseline.clicks,70);
  assert.equal(report.followup.clicks,35);
  assert.equal(report.clicksChangePct,-50);
  assert.equal(report.impressionsChangePct,0);
  assert.equal(report.avgPositionChange,3);
  assert.equal(JSON.stringify(report).includes("shop.example"),false);
  assert.equal(JSON.stringify(report).includes("winter boots"),false);
});

test("missing GSC query-day is unknown, not zero or a confirmed traffic change",()=>{
  const input=evidence();
  input.response.rows=input.response.rows.filter(row=>row.keys[0]!=="2026-10-12");
  const report=assessGscRankEvidence(input,now);
  assert.equal(report.completeDateCoverage,false);
  assert.equal(report.missingFollowupDates,1);
  assert.equal(report.clicksChangePct,null);
  assert.equal(report.impressionsChangePct,null);
  assert.equal(report.avgPositionChange,null);
});

test("refuses cross-tenant pages and broader Search Console properties",()=>{
  const a=evidence();a.incident.targetUrl="https://other.example/products/boots";
  assert.throws(()=>assessGscRankEvidence(a,now),/outside/);
  const b=evidence();b.request.siteUrl="https://another.example/";
  assert.throws(()=>assessGscRankEvidence(b,now),/exact HTTPS/);
  const c=evidence();c.request.siteUrl="sc-domain:shop.example";
  assert.throws(()=>assessGscRankEvidence(c,now),/exact HTTPS/);
});

test("refuses unrelated query/device filters, non-Google markets and non-page aggregation",()=>{
  const a=evidence();a.request.dimensionFilterGroups[0].filters[0].expression="unrelated";
  assert.throws(()=>assessGscRankEvidence(a,now),/filters/);
  const b=evidence();b.incident.engine="bing";
  assert.throws(()=>assessGscRankEvidence(b,now),/Google search market/);
  const c=evidence();c.response.responseAggregationType="byProperty";
  assert.throws(()=>assessGscRankEvidence(c,now),/byPage/);
  const d=evidence();d.request.dimensionFilterGroups[0].filters.push(
    {dimension:"query",operator:"equals",expression:"winter boots"});
  assert.throws(()=>assessGscRankEvidence(d,now),/filters/);
});

test("refuses incomplete, cherry-picked or future evidence windows",()=>{
  const a=evidence();a.request.dataState="all";
  assert.throws(()=>assessGscRankEvidence(a,now),/finalized/);
  const b=evidence();b.request.startDate="2026-10-04";
  assert.throws(()=>assessGscRankEvidence(b,now),/fixed 15-day/);
  const c=evidence();c.incident.observedAt="2026-10-30T12:00:00Z";
  assert.throws(()=>assessGscRankEvidence(c,now),/future/);
  const d=evidence();d.response.rows.push(d.response.rows[0]);
  assert.throws(()=>assessGscRankEvidence(d,now),/duplicate/);
  const e=evidence();e.request.dimensions=["date","page"];
  assert.throws(()=>assessGscRankEvidence(e,now),/date-only/);
});

test("does not invent a percent change from a zero-click baseline",()=>{
  const input=evidence();
  for(const row of input.response.rows.slice(0,7)){row.clicks=0;row.ctr=0;}
  const report=assessGscRankEvidence(input,now);
  assert.equal(report.completeDateCoverage,true);
  assert.equal(report.clicksChangePct,null);
});

test("requires timezone-qualified timestamps and a valid GSC row limit",()=>{
  const a=evidence();a.incident.observedAt="2026-10-10T12:00:00";
  assert.throws(()=>assessGscRankEvidence(a,now),/timestamp/);
  const b=evidence();b.request.rowLimit=25001;
  assert.throws(()=>assessGscRankEvidence(b,now),/fixed 15-day/);
});

test("abstains before the seven-day followup has finalized",()=>{
  const input=evidence();
  assert.throws(()=>assessGscRankEvidence(input,new Date("2026-10-18T12:00:00Z")),
    /too recent/);
});
