import type { HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Link, useLoaderData } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import { AGENTS, STATUS_LABELS } from "../lib/agent-registry";

export const loader = async ({request}: LoaderFunctionArgs) => {
  const { session } = await authenticate.admin(request);
  return {shop:session.shop};
};
export default function Team() {
  const {shop} = useLoaderData<typeof loader>();
  return <s-page heading="Your AI Ecommerce Team">
    <s-section heading="Store operating system">
      <p>Shop: {shop}</p>
      <p>This directory describes the platform roadmap. A prototype is not a connected or running agent. Changes to live store content require merchant review; prohibited operations stay blocked.</p>
      <p><Link to="/app">Open Blog Agent</Link> · <Link to="/app/seo">Open SEO workspace</Link></p>
    </s-section>
    <s-section heading="Specialist agents">
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit,minmax(280px,1fr))",gap:12}}>
        {AGENTS.map(agent => <section key={agent.id} style={{border:"1px solid #dedede",borderRadius:12,padding:16}}>
          <h2 style={{fontSize:17,margin:0}}>{agent.name}</h2>
          <p style={{fontSize:12,color:"#666"}}>{agent.domain} · {STATUS_LABELS[agent.status]}</p>
          <p>{agent.purpose}</p>
          <p style={{fontSize:12}}><strong>Next:</strong> {agent.nextMilestone}</p>
          <details><summary>Permissions and prerequisites</summary>
            <p>Allowed design capabilities: {agent.permitted.join(", ")}</p>
            <p>Requires: {agent.requires.join(", ")}</p>
          </details>
        </section>)}
      </div>
    </s-section>
  </s-page>;
}
export const headers: HeadersFunction = args => boundary.headers(args);
