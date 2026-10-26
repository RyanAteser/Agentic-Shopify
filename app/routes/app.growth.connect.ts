import type {LoaderFunctionArgs} from "react-router";
import {redirect} from "react-router";
import {authenticate} from "../shopify.server";
import db from "../db.server";
import {randomOAuthState} from "../lib/gsc-crypto.server";
import {googleAuthorizationUrl} from "../lib/gsc.server";

/** Must be navigated at the top-level for Google's non-iframe OAuth consent. */
export const loader=async ({request}:LoaderFunctionArgs)=>{
  const {session}=await authenticate.admin(request);
  const shop=session.shop;
  const pending=await db.googleAuthState.count({where:{shop,expiresAt:{gt:new Date()}}});
  if(pending>=3)return redirect("/app/growth?error=rate");
  // Check configuration before creating a state.
  const {raw,hash}=randomOAuthState();
  const target=googleAuthorizationUrl(raw);
  await db.googleAuthState.create({
    data:{stateHash:hash,shop,expiresAt:new Date(Date.now()+10*60000)}
  });
  return redirect(target);
};
