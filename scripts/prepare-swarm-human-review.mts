import {mkdir,readFile,writeFile} from "node:fs/promises";
import {join} from "node:path";
import {
  makeReviewerPacket,reviewerSubmissionTemplate,
  validateSubmittedReviewer,realCohortReadiness,
  type PrivateMerchantCapture,type ReviewerSubmission
} from "../app/lib/swarm-real-intake";

/** Local-only. No Shopify API, Gemini, customer data, billing or database writes. */
const root=join(process.env.LOCALAPPDATA??process.cwd(),
  "AgenticShopify","Evaluations","RealEvidenceIntake");
async function loadCapture():Promise<PrivateMerchantCapture>{
  const privatePath=join(root,"artemis-calibration-first-observation.json");
  const contents=await readFile(privatePath,"utf8");
  if(contents.length>50000)throw new Error("Capture file exceeds expected bound.");
  return JSON.parse(contents) as PrivateMerchantCapture;
}
async function main(){
  const mode=process.argv.slice(2).join(" ");
  if(!["--prepare-calibration-reviewers","--calibration-review-status"].includes(mode)){
    throw new Error("Usage: --prepare-calibration-reviewers | --calibration-review-status");
  }
  const capture=await loadCapture();
  const packet=makeReviewerPacket(capture);
  const dir=join(root,"ReviewerPackets");
  await mkdir(dir,{recursive:true});
  const paths=["A","B"].map(letter=>({
    packet:join(dir,"reviewer-"+letter+"-blind-packet.json"),
    submission:join(dir,"reviewer-"+letter+"-submission.json")
  }));
  if(mode==="--prepare-calibration-reviewers"){
    const empty=reviewerSubmissionTemplate(capture);
    for(const path of paths){
      await writeFile(path.packet,JSON.stringify(packet,null,2),
        {encoding:"utf8",flag:"wx"});
      await writeFile(path.submission,JSON.stringify(empty,null,2),
        {encoding:"utf8",flag:"wx"});
    }
    process.stdout.write(JSON.stringify({
      status:"separate_reviewer_packets_prepared",
      packetCount:2,caseCount:packet.cases.length,
      humanReviewerJudgments:0,
      reviewerIdentityVerified:false,
      modelRequests:0,shopifyReads:0,shopifyWrites:0
    })+"\n");
    return;
  }
  const submissions:ReviewerSubmission[]=[];
  for(const path of paths){
    let data:unknown;
    try{
      const contents=await readFile(path.submission,"utf8");
      if(contents.length>50000)throw new Error("Oversized reviewer file.");
      data=JSON.parse(contents) as unknown;
    }catch(e){
      if(e&&typeof e==="object"&&"code" in e&&e.code==="ENOENT")continue;
      throw new Error("Reviewer file unreadable.");
    }
    const a=data as {reviewerId?:unknown};
    if(!a?.reviewerId)continue; // Unfilled templates are not reviewer evidence.
    submissions.push(validateSubmittedReviewer(data,capture));
  }
  if(submissions.length===2&&submissions[0].reviewerId===submissions[1].reviewerId){
    throw new Error("Distinct reviewers required.");
  }
  const status=realCohortReadiness({
    captures:[capture],reviews:submissions.flatMap(x=>x.reviews),pairedModelCases:[]
  });
  process.stdout.write(JSON.stringify({
    status:"read_only_review_status",
    packetsPrepared:2,submittedCompleteReviewers:submissions.length,
    humanReviewPairsAgreed:status.humanReviewPairsAgreed,
    humanReviewPairsDisputed:status.humanReviewPairsDisputed,
    observedCases:status.observedCases,
    eligibleHoldoutCases:status.eligibleHoldoutCandidateCases,
    actualIndependentReviewerIdentityVerified:false,
    real30CaseStudyComplete:false,modelRequests:0,shopifyWrites:0
  })+"\n");
}
main().catch(e=>{
  process.stderr.write("Reviewer intake stopped: "+
    (e instanceof Error?e.name:"UnknownError")+"\n");
  process.exitCode=1;
});
