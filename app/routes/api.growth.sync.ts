import type {ActionFunctionArgs} from "react-router";
import {authorizedBridge} from "../lib/agent.server";
import db from "../db.server";
import {syncOrganicMetrics} from "../lib/gsc.server";

/** Read-only Google data import: no publishing, customer orders, or store changes. */
import { assertPilotServiceDisabled } from "../lib/pilot-readonly";

export const action=async ({request}:ActionFunctionArgs)=>{
  assertPilotServiceDisabled();
  if(request.method!=="POST")return Response.json({error:"Method not allowed"},{status:405});
  if(!authorizedBridge(request))return Response.json({error:"Unauthorized"},{status:401});
  const now=new Date();
  const due=new Date(now.getTime()-25*3600000);
  const rows=await db.searchConsoleConnection.findMany({
    where:{status:"active",OR:[{lastSyncedAt:null},{lastSyncedAt:{lt:due}}]},
    take:10,orderBy:{lastSyncedAt:"asc"},select:{shop:true}
  });
  let succeeded=0,failed=0;
  for(const row of rows){
    try{await syncOrganicMetrics(row.shop,now);succeeded++;}
    catch(err){failed++;console.error("GSC scheduled sync failed",row.shop,err instanceof Error?err.message:"unknown");}
  }
  return Response.json({selected:rows.length,succeeded,failed});
};
