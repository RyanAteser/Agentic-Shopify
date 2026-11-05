import type { ActionFunctionArgs } from "react-router";
import { authenticate } from "../shopify.server";
import { assertPilotShop } from "../lib/pilot-readonly";
import { eraseMerchantData } from "../lib/merchant-redaction.server";

export const action = async ({ request }: ActionFunctionArgs) => {
  const { shop } = await authenticate.webhook(request);
  assertPilotShop(shop);
  await eraseMerchantData(shop);
  return new Response(null, { status: 200 });
};
