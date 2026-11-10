import db from "../db.server";

export type BudgetExposure={
  month:string;
  configured:boolean;
  policyEnabled:boolean|null;
  monthlyCapCents:number|null;
  perJobReserveCents:number|null;
  heldCents:number;
  heldJobCount:number;
  currentHeadroomCents:number|null;
  overCurrentPolicyCap:boolean|null;
  evidence:"internal_immutable_reservations_not_vendor_invoices";
};

function checkedShopMonth(shop:string,month:string){
  if(!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(shop)||
     !/^(20[2-9]\d)-(0[1-9]|1[0-2])$/.test(month)){
    throw new Error("Exact shop and UTC reporting month required");
  }
}
/**
 * Shop-scoped budget exposure, NOT an actual provider bill.
 *
 * Sum immutable job claims and compare them against the committed monthly
 * counter. If accounting is corrupt or a prior transaction was incomplete,
 * refuse to show merchant headroom as if it were trustworthy.
 */
export async function loadBudgetExposure(shop:string,month:string):Promise<BudgetExposure>{
  checkedShopMonth(shop,month);
  const [policy,monthRow,claims]=await Promise.all([
    db.blogBudgetPolicy.findUnique({
      where:{shop},select:{enabled:true,monthlyCapCents:true,perJobReserveCents:true}
    }),
    db.blogBudgetMonth.findUnique({
      where:{shop_month:{shop,month}},select:{committedCents:true}
    }),
    db.blogBudgetClaim.aggregate({
      where:{shop,month},_sum:{reservedCents:true},_count:{_all:true}
    })
  ]);
  const heldCents=monthRow?.committedCents??0;
  const totalClaimed=claims._sum.reservedCents??0;
  const heldJobCount=claims._count._all;
  if(!Number.isSafeInteger(heldCents)||heldCents<0||
     !Number.isSafeInteger(totalClaimed)||totalClaimed<0||
     !Number.isSafeInteger(heldJobCount)||heldJobCount<0||
     totalClaimed!==heldCents){
    throw new Error("Blog cost allowance reconciliation failed; no headroom can be reported");
  }
  if(!policy){
    if(heldCents!==0)throw new Error("Budget policy absent with committed exposure");
    return {month,configured:false,policyEnabled:null,monthlyCapCents:null,
      perJobReserveCents:null,heldCents,heldJobCount,currentHeadroomCents:null,
      overCurrentPolicyCap:null,evidence:"internal_immutable_reservations_not_vendor_invoices"};
  }
  if(!Number.isSafeInteger(policy.monthlyCapCents)||policy.monthlyCapCents<1||
     !Number.isSafeInteger(policy.perJobReserveCents)||policy.perJobReserveCents<1){
    throw new Error("Invalid stored budget policy");
  }
  return {
    month,configured:true,policyEnabled:policy.enabled,
    monthlyCapCents:policy.monthlyCapCents,perJobReserveCents:policy.perJobReserveCents,
    heldCents,heldJobCount,
    currentHeadroomCents:Math.max(0,policy.monthlyCapCents-heldCents),
    overCurrentPolicyCap:heldCents>policy.monthlyCapCents,
    evidence:"internal_immutable_reservations_not_vendor_invoices"
  };
}
