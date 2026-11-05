import type {LoaderFunctionArgs} from "react-router";
import db from "../db.server";
import {assertPilotConfiguration} from "../lib/pilot-readonly";

/** Sanitized readiness endpoint for deployment load balancers. */
export const loader=async (_args:LoaderFunctionArgs)=>{
  try{
    // A reachable database is not enough to accept traffic when a single-
    // merchant read-only deployment is misconfigured. Fail closed before
    // reporting readiness, without contacting Shopify or exposing secrets.
    assertPilotConfiguration();
    await db.$queryRawUnsafe("SELECT 1");
    return Response.json({status:"ready"},{headers:{"Cache-Control":"no-store"}});
  }catch(error){
    console.error("Readiness dependency check failed",error instanceof Error?error.name:"unavailable");
    return Response.json({status:"unavailable"},{status:503,headers:{"Cache-Control":"no-store"}});
  }
};
