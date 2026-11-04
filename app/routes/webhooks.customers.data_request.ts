import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { assertPilotShop } from "../lib/pilot-readonly";
// App does not ingest Shopify customer records in this version.
export const action = async ({request}:ActionFunctionArgs) => {
 const { shop } = await authenticate.webhook(request);
 assertPilotShop(shop);
 return new Response(null,{status:200});
};
