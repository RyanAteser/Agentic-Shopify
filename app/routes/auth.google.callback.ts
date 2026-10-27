import type {LoaderFunctionArgs} from "react-router";
import {redirect} from "react-router";
import db from "../db.server";
import {unauthenticated} from "../shopify.server";
import {hashState} from "../lib/gsc-crypto.server";
import {googleExchangeCode,verifyGoogleSite,storeGoogleConnection} from "../lib/gsc.server";

export const loader=async ({request}:LoaderFunctionArgs)=>{
  const url=new URL(request.url);
  const state=url.searchParams.get("state")||"";
  const code=url.searchParams.get("code")||"";
  if(state.length<30||state.length>200||code.length<5||code.length>4096||
    url.searchParams.has("error"))return new Response("Google authorization was not completed.",{status:400});
  // Finalization consumes this state atomically with the connection write.
  // A concurrent disconnect, uninstall or redaction invalidates it while Google
  // API requests are in flight, without allowing a stale callback to reconnect.
  const stateHash=hashState(state);
  const record=await db.googleAuthState.findUnique({where:{stateHash}});
  if(!record||record.expiresAt.getTime()<Date.now())return new Response("OAuth state expired or invalid.",{status:400});
  try{
    // Trust authenticated Shopify offline admin, NEVER a Google callback shop parameter.
    const {admin}=await unauthenticated.admin(record.shop);
    const response=await admin.graphql("#graphql query GrowthShopDomain { shop { primaryDomain { host } } }");
    const data:any=await response.json();
    if(data.errors?.length||!data.data?.shop?.primaryDomain?.host){
      throw new Error("Shopify primary domain not available");
    }
    const tokens=await googleExchangeCode(code);
    const property=await verifyGoogleSite(tokens.accessToken,String(data.data.shop.primaryDomain.host));
    await storeGoogleConnection(record.shop,property,tokens.refreshToken,stateHash);
    // Never put Google tokens, codes or properties into redirect/query params.
    return redirect("/app/growth?connected=1");
  }catch(err){
    console.error("Search Console connection rejected",err instanceof Error?err.message:"unknown");
    return new Response("Could not verify Search Console property for this store. Reconnect from Agentic Shopify.",{status:400});
  }
};
