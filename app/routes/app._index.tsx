import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { dispatchArticleJob } from "../lib/agent.server";

function value(form: FormData, key: string, max = 500) {
  return String(form.get(key) ?? "").trim().slice(0, max);
}
async function blogOptions(admin: any) {
  const response = await admin.graphql(
    "query AgenticShopifyBlogs { blogs(first: 50) { nodes { id title } } }"
  );
  const result = await response.json();
  if (result.errors?.length) throw new Error("Cannot load Shopify blogs");
  return result.data?.blogs?.nodes ?? [];
}

export const loader = async ({ request }: LoaderFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const [blogs, config, drafts, jobs] = await Promise.all([
    blogOptions(admin),
    db.storeConfig.upsert({ where: { shop: session.shop }, create: { shop: session.shop }, update: {} }),
    db.articleDraft.findMany({ where: { shop: session.shop }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.contentJob.findMany({ where: { shop: session.shop }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  return { shop: session.shop, blogs, config, drafts, jobs };
};

export const action = async ({ request }: ActionFunctionArgs) => {
  const { admin, session } = await authenticate.admin(request);
  const shop = session.shop;
  const form = await request.formData();
  const intent = value(form, "intent", 30);
  try {
    if (intent === "save") {
      const allowed = await blogOptions(admin);
      const blogId = value(form, "blogId", 100);
      if (!allowed.some((b: {id:string}) => b.id === blogId)) return { ok: false, message: "Choose an existing Shopify blog." };
      const cadenceDays = Math.min(30, Math.max(1, Number(form.get("cadenceDays")) || 7));
      const enabled = form.get("enabled") === "on";
      const prev = await db.storeConfig.findUnique({ where: { shop } });
      await db.storeConfig.upsert({
        where: { shop },
        create: {
          shop, blogId,
          authorName: value(form, "authorName", 80) || "Editorial Team",
          audience: value(form, "audience", 1000),
          brandVoice: value(form, "brandVoice", 1000),
          seedTopics: value(form, "seedTopics", 1000),
          cadenceDays, enabled, nextRunAt: enabled ? new Date() : null,
        },
        update: {
          blogId,
          authorName: value(form, "authorName", 80) || "Editorial Team",
          audience: value(form, "audience", 1000),
          brandVoice: value(form, "brandVoice", 1000),
          seedTopics: value(form, "seedTopics", 1000),
          cadenceDays, enabled,
          nextRunAt: !enabled ? null : prev?.enabled ? prev.nextRunAt ?? new Date() : new Date(),
        },
      });
      return { ok: true, message: "Store preferences saved." };
    }
    if (intent === "generate") {
      const config = await db.storeConfig.findUnique({ where: { shop } });
      if (!config?.blogId) return { ok: false, message: "Save your content settings and select a blog first." };
      const topic = value(form, "topic", 140) || config.seedTopics.split(",")[0]?.trim();
      if (!topic || topic.length < 6) return { ok: false, message: "Enter a specific topic (at least 6 characters)." };
      const pending = await db.contentJob.count({
        where: { shop, status: { in: ["queued", "running"] }, createdAt: { gte: new Date(Date.now() - 3_600_000) } },
      });
      if (pending >= 3) return { ok: false, message: "Three drafts are already queued. Try again after they finish." };
      const job = await db.contentJob.create({ data: { shop, topic } });
      try {
        await dispatchArticleJob(job.id, shop);
        return { ok: true, message: "Draft requested. Refresh shortly to see the completed article." };
      } catch (error) {
        await db.contentJob.update({ where: { id: job.id }, data: { status: "failed", error: String(error).slice(0, 400) } });
        throw error;
      }
    }
    if (intent === "reject") {
      const id = value(form, "draftId", 100);
      const notes = value(form, "feedback", 1000);
      if (!notes) return { ok: false, message: "Explain what should improve so the agent can learn." };
      const result = await db.articleDraft.updateMany({
        where: { id, shop, status: { in: ["ready", "needs_review"] } },
        data: { status: "rejected", reviewNotes: notes },
      });
      return { ok: result.count === 1, message: result.count ? "Rejected draft feedback saved for future briefs." : "Draft not found or already processed." };
    }
    if (intent === "publish") {
      const id = value(form, "draftId", 100);
      const claim = await db.articleDraft.updateMany({
        where: { id, shop, status: "ready", seoScore: { gte: 70 } },
        data: { status: "publishing" },
      });
      if (!claim.count) return { ok: false, message: "Draft is not approved for publication. Resolve quality warnings first." };
      const draft = await db.articleDraft.findUniqueOrThrow({ where: { id } });
      const config = await db.storeConfig.findUniqueOrThrow({ where: { shop } });
      try {
        // Each merchant explicitly clicks Publish. No AI/n8n token may call this action.
        const response = await admin.graphql(
          "mutation AgenticShopifyArticleCreate($article: ArticleCreateInput!) { articleCreate(article: $article) { article { id title handle } userErrors { field message } } }",
          {
            variables: { article: {
              blogId: config.blogId, title: draft.title, body: draft.body,
              summary: draft.summary, author: { name: config.authorName },
              tags: draft.tags.split(",").map(x => x.trim()).filter(Boolean),
              isPublished: true,
            } },
          }
        );
        const json: any = await response.json();
        const errors = [...(json.errors ?? []), ...(json.data?.articleCreate?.userErrors ?? [])];
        const article = json.data?.articleCreate?.article;
        if (errors.length || !article?.id) throw new Error(errors.map((e: {message:string}) => e.message).join("; ") || "Shopify refused article");
        await db.articleDraft.update({ where: { id }, data: { status: "published", shopifyArticleId: article.id, publishedAt: new Date() } });
        return { ok: true, message: "Published to Shopify: " + article.title };
      } catch (error) {
        // If Shopify succeeds but DB write fails, manual reconciliation is required before retrying.
        await db.articleDraft.updateMany({ where: { id, shop, status: "publishing" }, data: { status: "needs_reconciliation" } });
        console.error("Publish requires reconciliation", error);
        return { ok: false, message: "Publishing was not fully confirmed. Check Shopify Articles before retrying." };
      }
    }
    return { ok: false, message: "Unknown action." };
  } catch (error) {
    console.error("Blog agent action failed", error);
    return { ok: false, message: error instanceof Error ? error.message : "Action failed" };
  }
};

export default function BlogAgent() {
  const { shop, blogs, config, drafts, jobs } = useLoaderData<typeof loader>();
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  return <s-page heading="Agentic Shopify · Blog Agent">
    <s-section heading="Content automation">
      <p>Connected store: <strong>{shop}</strong></p>
      <p>n8n researches and writes a draft; you inspect the content before publishing. Automatic generation creates drafts only.</p>
      {result && <p role="status"><strong>{result.ok ? "Success:" : "Attention:"}</strong> {result.message}</p>}
      <Form method="post" style={{display:"grid",gap:12,maxWidth:850}}>
        <input type="hidden" name="intent" value="save"/>
        <label>Destination blog <select name="blogId" defaultValue={config.blogId} required>
          <option value="">Select a blog</option>
          {blogs.map((b: {id:string;title:string}) => <option key={b.id} value={b.id}>{b.title}</option>)}
        </select></label>
        <label>Author name <input name="authorName" maxLength={80} defaultValue={config.authorName} required/></label>
        <label>Target audience <textarea name="audience" rows={2} maxLength={1000} defaultValue={config.audience} placeholder="Who are we helping, and what do they need?"/></label>
        <label>Brand voice <textarea name="brandVoice" rows={2} maxLength={1000} defaultValue={config.brandVoice} placeholder="Tone, positioning, factual boundaries and product vocabulary"/></label>
        <label>Topic ideas (comma-separated) <textarea name="seedTopics" rows={2} maxLength={1000} defaultValue={config.seedTopics}/></label>
        <label>Days between automatic drafts <input name="cadenceDays" type="number" min={1} max={30} defaultValue={config.cadenceDays}/></label>
        <label><input name="enabled" type="checkbox" defaultChecked={config.enabled}/> Automatically create drafts on schedule (never auto-publish)</label>
        <button type="submit" disabled={busy}>Save preferences</button>
      </Form>
    </s-section>
    <s-section heading="Request a blog draft">
      <Form method="post" style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <input type="hidden" name="intent" value="generate"/>
        <input name="topic" minLength={6} maxLength={140} placeholder="e.g. How to choose a shade for ..." style={{minWidth:300,flex:1}} required/>
        <button type="submit" disabled={busy || !config.blogId}>Generate draft with n8n</button>
      </Form>
    </s-section>
    <s-section heading="Draft review queue">
      {!drafts.length && <p>No drafts yet. Create a draft above to start your content pipeline.</p>}
      {drafts.map(d => <article key={d.id} style={{border:"1px solid #ddd",borderRadius:12,padding:16,marginBottom:16}}>
        <h2>{d.title}</h2>
        <p><strong>Status:</strong> {d.status} · <strong>Structural quality:</strong> {d.seoScore}/100 · <strong>Topic:</strong> {d.topic}</p>
        <p>{d.summary}</p>
        <details><summary>Read full draft and review notes</summary>
          <div style={{padding:10,border:"1px solid #ddd",maxHeight:400,overflow:"auto"}} dangerouslySetInnerHTML={{__html:d.body}}/>
          <pre style={{whiteSpace:"pre-wrap"}}>{d.reviewNotes}</pre>
        </details>
        {d.status === "ready" && <Form method="post" onSubmit={e => {
          if (!window.confirm("Publish this article immediately to your Shopify store? You must have verified all claims and source links.")) e.preventDefault();
        }}>
          <input type="hidden" name="intent" value="publish"/>
          <input type="hidden" name="draftId" value={d.id}/>
          <button type="submit" disabled={busy}>Publish to Shopify</button>
        </Form>}
        {["ready", "needs_review"].includes(d.status) && <Form method="post" style={{display:"flex",gap:8,marginTop:8}}>
          <input type="hidden" name="intent" value="reject"/>
          <input type="hidden" name="draftId" value={d.id}/>
          <input name="feedback" placeholder="Why should this draft be improved?" required maxLength={1000} style={{flex:1}}/>
          <button type="submit" disabled={busy}>Reject and teach agent</button>
        </Form>}
      </article>)}
    </s-section>
    <s-section heading="Recent generation jobs">
      <ul>{jobs.map(j => <li key={j.id}>{j.topic}: {j.status}{j.error ? " — " + j.error : ""}</li>)}</ul>
    </s-section>
  </s-page>;
}
export const headers: HeadersFunction = args => boundary.headers(args);
