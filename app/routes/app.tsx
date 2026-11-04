import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Outlet, useLoaderData, useRouteError } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { AppProvider } from "@shopify/shopify-app-react-router/react";
import { NavMenu } from "@shopify/app-bridge-react";
import "../embedded-controls.css";

import { authenticate } from "../shopify.server";
import { readOnlyPilotEnabled } from "../lib/pilot-readonly";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  await authenticate.admin(request);

  // eslint-disable-next-line no-undef
  return { apiKey: process.env.SHOPIFY_API_KEY || "" };
};

export default function App() {
  const { apiKey } = useLoaderData<typeof loader>();

  return (
    <AppProvider apiKey={apiKey}>
      <NavMenu>
        {readOnlyPilotEnabled() ? <a href="/app/catalog" rel="home">Catalog pilot</a> : <>
        <a href="/app" rel="home">Blog Agent</a>
        <a href="/app/manager">Store Manager</a>
        <a href="/app/team">AI Team</a>
        <a href="/app/seo">SEO Intelligence</a>
        <a href="/app/growth">Verified Growth</a>
        </>}
      </NavMenu>
      <Outlet />
    </AppProvider>
  );
}

// Shopify needs React Router to catch some thrown responses, so that their headers are included in the response.
export function ErrorBoundary() {
  return boundary.error(useRouteError());
}

export const headers: HeadersFunction = (headersArgs) => {
  return boundary.headers(headersArgs);
};
