import "@shopify/shopify-app-react-router/adapters/node";
import {
  ApiVersion,
  AppDistribution,
  shopifyApp,
} from "@shopify/shopify-app-react-router/server";
import { PrismaSessionStorage } from "@shopify/shopify-app-session-storage-prisma";
import prisma from "./db.server";
import { assertPilotRequest, assertPilotShop, readOnlyPilotEnabled } from "./lib/pilot-readonly";

const shopify = shopifyApp({
  apiKey: process.env.SHOPIFY_API_KEY,
  apiSecretKey: process.env.SHOPIFY_API_SECRET || "",
  apiVersion: ApiVersion.October26,
  scopes: process.env.SCOPES?.split(","),
  appUrl: process.env.SHOPIFY_APP_URL || "",
  authPathPrefix: "/auth",
  sessionStorage: new PrismaSessionStorage(prisma),
  distribution: readOnlyPilotEnabled() ? AppDistribution.SingleMerchant : AppDistribution.AppStore,
  future: {
    expiringOfflineAccessTokens: true,
  },
  ...(process.env.SHOP_CUSTOM_DOMAIN
    ? { customShopDomains: [process.env.SHOP_CUSTOM_DOMAIN] }
    : {}),
});

export default shopify;
export const apiVersion = ApiVersion.October26;
export const addDocumentResponseHeaders = shopify.addDocumentResponseHeaders;
// The shared application has more capabilities than this one-store pilot.
// Enforce the pilot boundary before every authenticated merchant route,
// including POST actions, rather than relying only on hidden UI links.
const guardedAdmin = (async (...args: Parameters<typeof shopify.authenticate.admin>) => {
  assertPilotRequest(args[0]);
  const context = await shopify.authenticate.admin(...args);
  assertPilotShop(context.session.shop);
  return context;
}) as typeof shopify.authenticate.admin;
export const authenticate = { ...shopify.authenticate, admin: guardedAdmin };
export const unauthenticated = shopify.unauthenticated;
export const login = shopify.login;
export const registerWebhooks = shopify.registerWebhooks;
export const sessionStorage = shopify.sessionStorage;
