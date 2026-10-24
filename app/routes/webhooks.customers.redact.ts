import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
// No customer-level records are stored by the current application.
export const action = async ({request}:ActionFunctionArgs) => {
 await authenticate.webhook(request);
 return new Response(null,{status:200});
};
