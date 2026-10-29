import { test } from "node:test";
import assert from "node:assert/strict";
import { replayRankingAlerts } from "../app/lib/rank-replay";

const now = new Date("2026-10-28T12:00:00Z");
const base = {keyword:"boots", country:"US", device:"desktop", engine:"google",
  targetUrl:"https://shop.example/products/boots"};
const point = (position:number, observedAt:string, fields:Record<string,unknown>={}) =>
  ({...base, position, observedAt, ...fields});
const fixture = {
  primaryHost:"shop.example",
  observations:[
    point(4,"2026-10-23T12:00:00Z"),
    point(9,"2026-10-24T12:00:00Z"),
    point(11,"2026-10-25T12:00:00Z"),
    point(4,"2026-10-26T08:00:00Z",{keyword:"socks",targetUrl:"https://shop.example/products/socks"}),
    point(9,"2026-10-26T09:00:00Z",{keyword:"socks",targetUrl:"https://shop.example/products/socks"}),
    point(12,"2026-10-26T10:00:00Z",{keyword:"socks",targetUrl:"https://shop.example/products/socks"})
  ]
};

test("offline replay distinguishes two-snapshot noise from independently dated confirmation",()=>{
  const report = replayRankingAlerts(fixture, now);
  assert.equal(report.observations,6);
  assert.equal(report.markets,2);
  assert.equal(report.observationDays,4);
  assert.equal(report.referenceTwoSnapshot.incidentDays,2);
  assert.equal(report.referenceTwoSnapshot.uniqueIncidents,2);
  assert.equal(report.confirmedThreeDay.incidentDays,1);
  assert.equal(report.confirmedThreeDay.uniqueIncidents,1);
  assert.deepEqual(report.comparison,{
    referenceOnlyIncidentDays:2, confirmedOnlyIncidentDays:1, bothIncidentDays:0
  });
  assert.equal(report.confirmedThreeDay.usefulAmongLabeledPct,null,
    "no labels cannot be reported as zero precision");
  assert.equal(JSON.stringify(report).includes("shop.example"),false,
    "aggregate output must not echo raw merchant URL");
});

test("replay labels count only known incidents and expose incomplete labeling",()=>{
  const labeled = {...fixture,labels:[
    {keyword:"boots",country:"US",device:"desktop",engine:"google",
      targetUrl:base.targetUrl,useful:true}
  ]};
  const report = replayRankingAlerts(labeled,now);
  assert.equal(report.confirmedThreeDay.labeledUseful,1);
  assert.equal(report.confirmedThreeDay.usefulAmongLabeledPct,100);
  assert.equal(report.referenceTwoSnapshot.unlabeled,1);
  assert.equal(report.referenceTwoSnapshot.usefulAmongLabeledPct,100);
  assert.equal(report.labelsSupplied,1);
  assert.throws(()=>replayRankingAlerts({...fixture,labels:[
    {...labeled.labels[0],targetUrl:"https://shop.example/products/unknown",useful:true}
  ]},now),/unrecognized/);
  assert.throws(()=>replayRankingAlerts({...fixture,labels:[
    labeled.labels[0],labeled.labels[0]
  ]},now),/Duplicate/);
});

test("replay is deterministic under input order and rejects tenant contamination",()=>{
  const a=replayRankingAlerts(fixture,now);
  const b=replayRankingAlerts({...fixture,observations:[...fixture.observations].reverse()},now);
  assert.deepEqual(a,b);
  assert.throws(()=>replayRankingAlerts({...fixture,observations:[
    ...fixture.observations,point(12,"2026-10-27T12:00:00Z",
      {targetUrl:"https://another-shop.example/products/boots"})
  ]},now),/primary domain/);
  assert.throws(()=>replayRankingAlerts({...fixture,observations:[
    ...fixture.observations,fixture.observations[0]
  ]},now),/Duplicate/);
  assert.throws(()=>replayRankingAlerts({...fixture,observations:[
    ...fixture.observations,point(12,"2026-10-29T12:00:00Z")
  ]},now),/timestamp outside|Future/);
  assert.throws(()=>replayRankingAlerts({...fixture,observations:[]},now),/1-5000/);
});

test("a contradictory intraday recovery prevents a confirmed incident",()=>{
  const observations=[...fixture.observations,
    point(5,"2026-10-25T15:00:00Z"),
    point(12,"2026-10-25T18:00:00Z")];
  const report=replayRankingAlerts({...fixture,observations},now);
  assert.equal(report.confirmedThreeDay.uniqueIncidents,0);
  assert.equal(report.confirmedThreeDay.usefulAmongLabeledPct,null);
});
