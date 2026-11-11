import type {Prisma} from "@prisma/client";

export class BlogBudgetBlockedError extends Error {
  constructor(reason:"unconfigured"|"paused"|"exhausted"|"invalid") {
    super(reason==="exhausted"?
      "Merchant monthly generation cost allowance exhausted; no worker dispatch was attempted.":
      "Merchant generation cost budget is not approved; no worker dispatch was attempted.");
    this.name="BlogBudgetBlockedError";
  }
}
export function generationMonthUTC(at:Date):string{
  if(!(at instanceof Date)||!Number.isFinite(at.getTime()))
    throw new BlogBudgetBlockedError("invalid");
  return at.toISOString().slice(0,7);
}
export function validBlogBudget(monthlyCapCents:number,perJobReserveCents:number){
  // Upper limits guard operator errors; they are NOT claims about real vendor charges.
  if(!Number.isSafeInteger(monthlyCapCents)||monthlyCapCents<1||monthlyCapCents>100_000||
     !Number.isSafeInteger(perJobReserveCents)||perJobReserveCents<1||
     perJobReserveCents>10_000||perJobReserveCents>monthlyCapCents)
    throw new BlogBudgetBlockedError("invalid");
}
function enforcementOn(env:Record<string,string|undefined>):boolean{
  const raw=env.BLOG_BUDGET_ENFORCE;
  if(raw===undefined||raw==="false")return false;
  if(raw==="true")return true;
  throw new BlogBudgetBlockedError("invalid");
}

/**
 * Call strictly within the StoreConfig -> ContentJob dispatch claim transaction.
 * Owner config and monthly exposure are separate from Shopify paid entitlements.
 *
 * Exposure is reserved BEFORE the first network POST. It remains locked after
 * uncertain transport, callback completion, or server crash; reconciliation
 * of verified vendor receipts and refunds requires an operator. This avoids
 * "refund then retry" overspend. Claim state is immutable, one per job.
 *
 * This is a prospective spend *allowance*, NOT a guaranteed upper bound on
 * OpenAI/n8n invoices: models, input size and paid third-party tools must also
 * be constrained at their individual API/provider boundaries.
 */
export async function reserveBlogDispatchAllowance(
  tx:Prisma.TransactionClient,
  shop:string,jobId:string,at:Date,
  env:Record<string,string|undefined>=process.env
):Promise<void>{
  if(!enforcementOn(env))return; // Development remains inert unless explicitly enabled.
  const month=generationMonthUTC(at);
  const policy=await tx.blogBudgetPolicy.findUnique({where:{shop}});
  if(!policy)throw new BlogBudgetBlockedError("unconfigured");
  if(!policy.enabled)throw new BlogBudgetBlockedError("paused");
  validBlogBudget(policy.monthlyCapCents,policy.perJobReserveCents);
  // Caller holds StoreConfig row lock, serializing all merchant dispatch claims.
  const used=await tx.blogBudgetMonth.upsert({
    where:{shop_month:{shop,month}},
    create:{shop,month},update:{}
  });
  const available=policy.monthlyCapCents-policy.perJobReserveCents;
  if(used.committedCents>available)throw new BlogBudgetBlockedError("exhausted");
  const claimed=await tx.blogBudgetMonth.updateMany({
    where:{shop,month,committedCents:{lte:available}},
    data:{committedCents:{increment:policy.perJobReserveCents}}
  });
  if(claimed.count!==1)throw new BlogBudgetBlockedError("exhausted");
  await tx.blogBudgetClaim.create({data:{
    shop,jobId,month,reservedCents:policy.perJobReserveCents
  }});
}

/** Owner-only policy provisioning, never accepts an unauthenticated browser plan. */
export async function setBlogBudgetPolicy(
  tx:Prisma.TransactionClient,
  shop:string,monthlyCapCents:number,perJobReserveCents:number,enabled:boolean
):Promise<void>{
  if(typeof enabled!=="boolean"||!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop))
    throw new BlogBudgetBlockedError("invalid");
  validBlogBudget(monthlyCapCents,perJobReserveCents);
  const lock=await tx.storeConfig.updateMany({where:{shop},data:{updatedAt:new Date()}});
  if(lock.count!==1)throw new BlogBudgetBlockedError("unconfigured");
  const installed=await tx.session.findFirst({where:{shop},select:{id:true}});
  if(!installed)throw new BlogBudgetBlockedError("unconfigured");
  await tx.blogBudgetPolicy.upsert({
    where:{shop},create:{shop,monthlyCapCents,perJobReserveCents,enabled},
    update:{monthlyCapCents,perJobReserveCents,enabled}
  });
}
