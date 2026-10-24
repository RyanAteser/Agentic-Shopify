import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
// App does not ingest Shopify customer records in this version.
export const action = async ({request}:ActionFunctionArgs) => {
 await authenticate.webhook(request);
 return new Response(null,{status:200});
};
