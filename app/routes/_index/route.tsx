import type { LoaderFunctionArgs } from "react-router";
import { redirect, Form, useLoaderData } from "react-router";

import { login } from "../../shopify.server";
import { readOnlyPilotEnabled, assertPilotConfiguration } from "../../lib/pilot-readonly";

import styles from "./styles.module.css";

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const url = new URL(request.url);

  if (readOnlyPilotEnabled()) {
    assertPilotConfiguration();
    // Shopify App Bridge supplies the signed host/shop context on first open.
    // Preserve that context while avoiding the full Blog Agent landing page.
    throw redirect(`/app/catalog?${url.searchParams.toString()}`);
  }

  if (url.searchParams.get("shop")) {
    throw redirect(`/app?${url.searchParams.toString()}`);
  }

  return { showForm: Boolean(login) };
};

export default function App() {
  const { showForm } = useLoaderData<typeof loader>();

  return (
    <div className={styles.index}>
      <div className={styles.content}>
        <h1 className={styles.heading}>Agentic Shopify</h1>
        <p className={styles.text}>
          Create better blog content from your Shopify admin, with human approval.
        </p>
        {showForm && (
          <Form className={styles.form} method="post" action="/auth/login">
            <label className={styles.label}>
              <span>Shop domain</span>
              <input className={styles.input} type="text" name="shop" />
              <span>e.g: my-shop-domain.myshopify.com</span>
            </label>
            <button className={styles.button} type="submit">
              Log in
            </button>
          </Form>
        )}
        <ul className={styles.list}>
          <li>
            <strong>Blog Agent.</strong> Prepare content drafts with a merchant
            review step before anything is published.
          </li>
          <li>
            <strong>Store Manager.</strong> Review actionable store tasks and
            approve changes individually.
          </li>
          <li>
            <strong>Verified Growth.</strong> See real Search Console performance
            after connecting your own verified property.
          </li>
        </ul>
      </div>
    </div>
  );
}
