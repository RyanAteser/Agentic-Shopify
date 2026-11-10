/**
 * Operator-only local budget configuration.
 * This does NOT enable paid entitlements, n8n or any model requests.
 *
 * Safety keys: BLOG_BUDGET_POLICY_ADMIN_ENABLED=true and exact
 * BLOG_BUDGET_POLICY_ADMIN_SHOP must be set by the owner.
 */
import db from "../app/db.server";
import {setBlogBudgetPolicy} from "../app/lib/blog-budget.server";

function parse(argv:string[]){
  const args=new Map<string,string>();
  for(let i=0;i<argv.length;i++){
    const key=argv[i];
    if(!["--shop","--monthly-cap-cents","--per-job-reserve-cents","--state"].includes(key)||
      !argv[i+1]||args.has(key))throw new Error("Invalid or duplicate budget flag");
    args.set(key,argv[++i]);
  }
  const shop=args.get("--shop")??"";
  const capText=args.get("--monthly-cap-cents")??"";
  const reserveText=args.get("--per-job-reserve-cents")??"";
  const state=args.get("--state");
  if(!/^(0|[1-9][0-9]*)$/.test(capText)||!/^(0|[1-9][0-9]*)$/.test(reserveText)||
      !["enabled","paused"].includes(state??"")){
    throw new Error("Expected --shop --monthly-cap-cents --per-job-reserve-cents --state enabled|paused");
  }
  return {shop,cap:Number(capText),reserve:Number(reserveText),enabled:state==="enabled"};
}
async function main(){
  const args=parse(process.argv.slice(2));
  if(process.env.BLOG_BUDGET_POLICY_ADMIN_ENABLED!=="true"||
     process.env.BLOG_BUDGET_POLICY_ADMIN_SHOP!==args.shop||
     !process.env.BLOG_BUDGET_POLICY_ADMIN_SHOP){
    throw new Error("Operator budget policy changes are disabled for this exact shop");
  }
  await db.$transaction(async tx=>{
    await setBlogBudgetPolicy(tx,args.shop,args.cap,args.reserve,args.enabled);
  },{timeout:10000});
  console.log(JSON.stringify({shop:args.shop,enabled:args.enabled,
    monthlyCapCents:args.cap,perJobReserveCents:args.reserve,
    billingVerified:false,n8nActivated:false,
    note:"Prospective job allowance, not actual vendor dollars or a provider cost cap"}));
}
main().catch(error=>{
  console.error("Budget policy setup blocked:",error instanceof Error?error.message:"unknown");
  process.exitCode=1;
}).finally(()=>db.$disconnect());
