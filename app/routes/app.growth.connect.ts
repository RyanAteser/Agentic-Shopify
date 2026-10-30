import type {LoaderFunctionArgs} from "react-router";
import {redirect} from "react-router";
import {authenticate} from "../shopify.server";
import {randomOAuthState} from "../lib/gsc-crypto.server";
import {beginGoogleAuthorization,databaseConsentTime,googleAuthorizationUrl} from "../lib/gsc.server";

/** Must be navigated at the top-level for Google's non-iframe OAuth consent. */
export const loader=async ({request}:LoaderFunctionArgs)=>{
  // Capture intent on the primary DB clock BEFORE asynchronous Shopify auth.
  // Never use the application worker clock for this revocation boundary.
  // A DB failure fails closed, before any OAuth state is created.
  const requestStartedAt=await databaseConsentTime();
  const {session}=await authenticate.admin(request);
  // Check configuration before creating a state or writing merchant records.
  const {raw,hash}=randomOAuthState();
  const target=googleAuthorizationUrl(raw);
  // authenticate.admin() may have completed before a concurrent uninstall.
  // Recheck the persisted, shop-scoped Session inside the same transaction
  // that creates the pending state; never resurrect data after redaction.
  const outcome=await beginGoogleAuthorization(session.shop,session.id,hash,requestStartedAt);
  if(outcome==="session_missing"){
    return new Response("Shopify session is no longer active. Reopen the installed app.",{status:409});
  }
  if(outcome==="revoked"){
    return new Response("Search Console was disconnected during this request. Start a new connection from the dashboard.",{status:409});
  }
  if(outcome==="rate_limited")return redirect("/app/growth?error=rate");
  return redirect(target);
};
