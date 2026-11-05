import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { assertPilotShop } from "../lib/pilot-readonly";
// No customer-level records are stored by the current application.
export const action = async ({request}:ActionFunctionArgs) => {
 const { shop } = await authenticate.webhook(request);
 assertPilotShop(shop);
 return new Response(null,{status:200});
};
