import type { ActionFunctionArgs, HeadersFunction, LoaderFunctionArgs } from "react-router";
import { Form, useActionData, useLoaderData, useNavigation } from "react-router";
import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import db from "../db.server";
import { dispatchArticleJob, UncertainDispatchError } from "../lib/agent.server";
import { DispatchAlreadyClaimedError, generationJobNotice } from "../lib/dispatch-claim.server";
import { createCreditedJob, failCreditedJob } from "../lib/credits.server";
import { FREE_LIFETIME_GENERATIONS } from "../lib/pricing";
import { publishApprovedArticle } from "../lib/publish.server";
import { loadMerchantConfig, saveMerchantConfig } from "../lib/merchant-config.server";
import { logStoreAction } from "../lib/manager.server";
import { parseReviewMinutes, recordEditorialReview } from "../lib/editorial-review.server";
import { hasCurrentUsableReview, reviewFormDigest, publishFormDigest } from "../lib/editorial-review-integrity";
import { editorialEditDigest, saveMerchantDraftEdit } from "../lib/editorial-edit.server";
import { safeArticlePreviewHtml } from "../lib/content-quality.server";
import { summarizeDraftLinks } from "../lib/article-link-review";

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
  // A request authenticated before uninstall may resume after the privacy
  // webhook. Lock the persisted session before initializing merchant data.
  const config = await loadMerchantConfig(session.shop, session.id);
  if (!config) throw new Response("Merchant session no longer active", { status: 401 });
  const [blogs, drafts, jobs] = await Promise.all([
    blogOptions(admin),
    db.articleDraft.findMany({ where: { shop: session.shop }, orderBy: { createdAt: "desc" }, take: 30 }),
    db.contentJob.findMany({ where: { shop: session.shop }, orderBy: { createdAt: "desc" }, take: 10 }),
  ]);
  const reviews = await db.editorialReview.findMany({
    where: {shop: session.shop, draftId: {in: drafts.map(d => d.id)}},
    select: {draftId: true, decision: true, reviewMinutes: true, contentDigest: true}
  });
  const draftMap = new Map(drafts.map(draft => [draft.id, draft]));
  const reviewStates = reviews.map(review => ({
    draftId: review.draftId, decision: review.decision, reviewMinutes: review.reviewMinutes,
    current: !!draftMap.get(review.draftId) &&
      hasCurrentUsableReview(review, draftMap.get(review.draftId)!, config)
  }));
  const draftPreviews = drafts.map(draft => ({draftId: draft.id, ...safeArticlePreviewHtml(draft.body)}));
  const draftLinkReviews = drafts.map(draft => ({draftId: draft.id, ...summarizeDraftLinks(draft.body)}));
  const editVersions = drafts.map(draft => ({draftId: draft.id, digest: editorialEditDigest(draft)}));
  const reviewVersions = drafts.map(draft => ({draftId: draft.id, digest: reviewFormDigest(draft, config)}));
  const publishVersions = drafts.map(draft => ({draftId: draft.id, digest: publishFormDigest(draft, config)}));
  // Expose only merchant-editable/displayed settings. Internal consent-order
  // BigInts must not be serialized into a loader response or leaked to UI.
  const visibleConfig = {
    blogId: config.blogId, authorName: config.authorName,
    audience: config.audience, brandVoice: config.brandVoice,
    seedTopics: config.seedTopics, cadenceDays: config.cadenceDays,
    enabled: config.enabled, freeDraftsUsed: config.freeDraftsUsed
  };
  return { shop: session.shop, blogs, config: visibleConfig, drafts, jobs: jobs.map(job => ({...job, healthNotice: generationJobNotice(job.status, job.updatedAt)})), reviews: reviewStates, draftPreviews, draftLinkReviews, editVersions, reviewVersions, publishVersions };
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
      const saved = await saveMerchantConfig(shop, session.id, {
        blogId,
        authorName: value(form, "authorName", 80) || "Editorial Team",
        audience: value(form, "audience", 1000),
        brandVoice: value(form, "brandVoice", 1000),
        seedTopics: value(form, "seedTopics", 1000),
        cadenceDays, enabled,
      });
      if (!saved) return { ok: false, message: "Store disconnected. Reinstall before saving settings." };
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
      const job = await createCreditedJob(shop, topic);
      try {
        await dispatchArticleJob(job.id, shop);
        return { ok: true, message: "Draft requested. Refresh shortly to see the completed article." };
      } catch (error) {
        if (!(error instanceof UncertainDispatchError) && !(error instanceof DispatchAlreadyClaimedError)) {
          await failCreditedJob(shop, job.id, error);
        }
        throw error;
      }
    }
    if (intent === "edit") {
      const id = value(form, "draftId", 100);
      const result = await saveMerchantDraftEdit(shop, id, value(form, "expectedDigest", 64), {
        title: form.get("title"), summary: form.get("summary"), body: form.get("body"),
        tags: form.get("tags"), keyword: form.get("keyword")
      });
      if (result.ok && !result.message.startsWith("No changes")) {
        await logStoreAction(shop, null, "article.edit", "saved",
          "Merchant revised an unpublished draft; approval renewal required", session.id)
          .catch(error => console.error("Could not append draft-edit activity", error));
      }
      return result;
    }
    if (intent === "review" || intent === "reject") {
      const id = value(form, "draftId", 100);
      const decision = intent === "reject" ? "rejected" : value(form, "decision", 20);
      if (decision !== "usable" && decision !== "rejected") {
        return {ok: false, message: "Invalid review decision."};
      }
      if (decision === "usable" && form.get("reviewed") !== "on") {
        return {ok: false, message: "Confirm you inspected the complete draft."};
      }
      return await recordEditorialReview(
        shop, id, decision, parseReviewMinutes(form.get("reviewMinutes")),
        value(form, "expectedReviewDigest", 64), value(form, "feedback", 1000)
      );
    }
    if (intent === "publish") {
      const id = value(form, "draftId", 100);
      if (form.get("verified") !== "on") return { ok: false, message: "Review the full article and verify claims, links and brand fit before publishing." };
      const result = await publishApprovedArticle(shop, id, admin, value(form, "expectedPublishDigest", 64));
      // The publisher is shared with the Store Manager inbox.
      if (result.ok) {
        await db.storeRecommendation.updateMany({
          where: { shop, sourceKey: "blog:" + id, status: { in: ["pending", "approved"] } },
          data: { status: "applied", decidedAt: new Date() },
        }).catch(error => console.error("Could not sync manager inbox", error));
      }
      await logStoreAction(shop, null, "article.publish", result.ok ? "applied" : "reconciliation_required",
        result.message, session.id).catch(error => console.error("Could not append store activity", error));
      return result;
    }
    return { ok: false, message: "Unknown action." };
  } catch (error) {
    console.error("Blog agent action failed", error);
    return { ok: false, message: error instanceof Error ? error.message : "Action failed" };
  }
};

export default function BlogAgent() {
  const { shop, blogs, config, drafts, jobs, reviews, draftPreviews, draftLinkReviews, editVersions, reviewVersions, publishVersions } = useLoaderData<typeof loader>();
  const previewMap = new Map(draftPreviews.map(preview => [preview.draftId, preview]));
  const linkReviewMap = new Map(draftLinkReviews.map(review => [review.draftId, review]));
  const editVersionMap = new Map(editVersions.map(version => [version.draftId, version.digest]));
  const reviewVersionMap = new Map(reviewVersions.map(version => [version.draftId, version.digest]));
  const publishVersionMap = new Map(publishVersions.map(version => [version.draftId, version.digest]));
  const reviewMap = new Map(reviews.map(review => [review.draftId, review]));
  const result = useActionData<typeof action>();
  const navigation = useNavigation();
  const busy = navigation.state !== "idle";
  const draftsAwaitingReview = drafts.filter(d => d.status === "ready" &&
    !(reviewMap.get(d.id)?.decision === "usable" && reviewMap.get(d.id)?.current)).length;
  const remainingGenerations = Math.max(0, FREE_LIFETIME_GENERATIONS - config.freeDraftsUsed);
  return <s-page heading="Agentic Shopify">
    <s-section heading="Store overview">
      <p>Connected to <strong>{shop}</strong>. Manage content and review store opportunities from one workspace. Nothing is published without your approval.</p>
      <div style={{display:"grid",gridTemplateColumns:"repeat(auto-fit, minmax(180px, 1fr))",gap:12,margin:"16px 0"}}>
        <div style={{background:"#f7f8fa",border:"1px solid #e2e5e9",borderRadius:12,padding:16}}>
          <p style={{margin:"0 0 8px",color:"#4a5565",fontSize:13}}>Drafts awaiting review</p>
          <p style={{fontSize:30,fontWeight:700,margin:0}}>{draftsAwaitingReview}</p>
          <p style={{margin:"8px 0 0",fontSize:12}}>Review before publishing</p>
        </div>
        <div style={{background:"#f7f8fa",border:"1px solid #e2e5e9",borderRadius:12,padding:16}}>
          <p style={{margin:"0 0 8px",color:"#4a5565",fontSize:13}}>Free generations left</p>
          <p style={{fontSize:30,fontWeight:700,margin:0}}>{remainingGenerations}</p>
          <p style={{margin:"8px 0 0",fontSize:12}}>Paid plans are not active</p>
        </div>
        <div style={{background:"#f7f8fa",border:"1px solid #e2e5e9",borderRadius:12,padding:16}}>
          <p style={{margin:"0 0 8px",color:"#4a5565",fontSize:13}}>Automatic draft scheduling</p>
          <p style={{fontSize:20,fontWeight:700,margin:"4px 0"}}>{config.enabled ? "Enabled" : "Off"}</p>
          <p style={{margin:"8px 0 0",fontSize:12}}>Drafts only, never auto-publication</p>
        </div>
      </div>
      <p><a href="/app/manager">Store Manager</a> | <a href="/app/team">AI Team</a> | <a href="/app/seo">SEO workspace</a> | <a href="/app/growth">Verified growth</a></p>
    </s-section>
    <s-section heading="Blog Agent setup">
      <p><a href="/app/manager">Store Manager</a> · <a href="/app/team">AI Store Team</a> · <a href="/app/seo">SEO Intelligence</a> · <a href="/app/growth">Verified Growth</a></p>
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
        <p>Disabling scheduling or changing the blog, topics or editorial settings cancels pending scheduled drafts that have not started, returning their reserved free credits. Drafts already dispatched may still finish. Manually requested drafts are unaffected.</p>
        <button type="submit" disabled={busy}>Save preferences</button>
      </Form>
    </s-section>
    <s-section heading="Request a blog draft">
      <p>Free plan: {Math.max(0, FREE_LIFETIME_GENERATIONS - config.freeDraftsUsed)} of {FREE_LIFETIME_GENERATIONS} lifetime generations remaining. Paid subscriptions will be enabled after Shopify billing setup.</p>
      {config.enabled && config.freeDraftsUsed >= FREE_LIFETIME_GENERATIONS && <p role="status">Scheduled draft creation is paused because all free generations have been used. No further jobs will be started until an authorized entitlement is available; paid billing is not enabled.</p>}
      <Form method="post" style={{display:"flex",gap:10,flexWrap:"wrap"}}>
        <input type="hidden" name="intent" value="generate"/>
        <input name="topic" minLength={6} maxLength={140} placeholder="e.g. How to choose a shade for ..." style={{minWidth:300,flex:1}} required/>
        <button type="submit" disabled={busy || !config.blogId}>Generate draft with n8n</button>
      </Form>
    </s-section>
    <s-section heading="Draft review queue">
      <p>The structure score does not verify SEO rankings, product facts or sources. Older drafts may retain scores from an earlier heuristic; review the full article regardless of score.</p>
      {!drafts.length && <p>No drafts yet. Create a draft above to start your content pipeline.</p>}
      {drafts.map(d => <article key={d.id} style={{border:"1px solid #ddd",borderRadius:12,padding:16,marginBottom:16}}>
        <h2>{d.title}</h2>
        <p><strong>Status:</strong> {d.status} · <strong>Draft structure (heuristic):</strong> {d.seoScore}/100 · <strong>Topic:</strong> {d.topic}</p>
        <p>{d.summary}</p>
        <details><summary>Read full draft and review notes</summary>
          {previewMap.get(d.id)?.changed && <p role="status">Safety preview: unsupported stored HTML or links are hidden. The original draft was not changed. Inspect and correct it in the editor before review.</p>}
          {previewMap.get(d.id)?.unavailable ? <p>Preview unavailable. Inspect the original HTML in the draft editor.</p> :
            <div style={{padding:10,border:"1px solid #ddd",maxHeight:400,overflow:"auto"}} dangerouslySetInnerHTML={{__html:previewMap.get(d.id)?.html ?? ""}}/>}
          <pre style={{whiteSpace:"pre-wrap"}}>{d.reviewNotes}</pre>
        </details>
        <details><summary>Review link destinations ({linkReviewMap.get(d.id)?.uniqueTotal ?? 0} unique)</summary>
          <p>This is an inventory from the sanitized preview, not proof that a destination is live, accurate or associated with a real product. Check each URL and any affiliate disclosures before approval.</p>
          {linkReviewMap.get(d.id)?.previewChanged && <p role="status">Stored HTML differs from the safe preview. Correct the draft before approving or publishing.</p>}
          {linkReviewMap.get(d.id)?.previewUnavailable ? <p>Link inventory unavailable because this draft cannot be safely previewed. Inspect and correct the original in the editor.</p> : <>
            {linkReviewMap.get(d.id)?.uniqueTotal === 0 && <p>No safe link destinations found in the preview.</p>}
            {(linkReviewMap.get(d.id)?.emptyAnchorOccurrences ?? 0) + (linkReviewMap.get(d.id)?.genericAnchorOccurrences ?? 0) > 0 &&
              <p role="status">Anchor-text review: {linkReviewMap.get(d.id)?.emptyAnchorOccurrences ?? 0} link occurrence(s) have no visible text or title; {linkReviewMap.get(d.id)?.genericAnchorOccurrences ?? 0} use generic labels such as "click here" or "read more". Consider descriptive, relevant link text. These are editorial suggestions, not ranking predictions.</p>}
            <ul>{linkReviewMap.get(d.id)?.links.map(link => <li key={link.href}>
              <strong>{link.kind === "store-relative" ? "Store-relative" : "Absolute HTTPS"}</strong>{link.host ? " (" + link.host + ")" : ""} · {link.occurrences} occurrence(s): <code style={{overflowWrap:"anywhere"}}>{link.href}</code>{link.emptyAnchorText > 0 && <> · <strong>Missing anchor text:</strong> {link.emptyAnchorText}</>}{link.genericAnchorText > 0 && <> · <strong>Generic anchor text:</strong> {link.genericAnchorText}</>}
            </li>)}</ul>
            {linkReviewMap.get(d.id)?.truncated && <p role="status">Only the first 20 unique links are shown, out of {linkReviewMap.get(d.id)?.uniqueTotal}. This is not a complete link review.</p>}
          </>}
        </details>
        {["ready", "needs_review"].includes(d.status) && <details>
          <summary>Edit this unpublished draft</summary>
          <p>Correct facts, wording and links before review. HTML supports paragraphs, headings, lists and safe links. Unsupported markup is removed. Saving does not publish, and any previous approval must be renewed.</p>
          <Form method="post" key={d.id + ":" + d.updatedAt} style={{display:"grid",gap:10,maxWidth:850}}>
            <input type="hidden" name="intent" value="edit"/>
            <input type="hidden" name="draftId" value={d.id}/>
            <input type="hidden" name="expectedDigest" value={editVersionMap.get(d.id) ?? ""}/>
            <label>Title <input name="title" defaultValue={d.title} maxLength={160} required/></label>
            <label>Excerpt (plain text) <textarea name="summary" rows={3} maxLength={500} defaultValue={d.summary} required/></label>
            <label>Article HTML <textarea name="body" rows={14} maxLength={60000} defaultValue={d.body} required style={{fontFamily:"monospace"}}/></label>
            <label>Tags (up to eight, comma-separated) <input name="tags" defaultValue={d.tags} maxLength={320}/></label>
            <label>Primary topic/keyword <input name="keyword" defaultValue={d.keyword} maxLength={120}/></label>
            <button type="submit" disabled={busy}>Save corrections (do not publish)</button>
          </Form>
        </details>}
        {reviewMap.has(d.id) && <p><strong>Editorial review:</strong> {reviewMap.get(d.id)?.decision === "usable"
          ? (reviewMap.get(d.id)?.current ? "Usable for current article" : "Outdated: review again before publishing")
          : "Rejected"} · {reviewMap.get(d.id)?.reviewMinutes ?? "No"} self-reported review minutes. This review does not publish.</p>}
        {d.status === "ready" && (!reviewMap.has(d.id) || (reviewMap.get(d.id)?.decision === "usable" && !reviewMap.get(d.id)?.current)) && <Form method="post" style={{display:"flex",gap:8,flexWrap:"wrap",alignItems:"center",marginTop:8}}>
          <input type="hidden" name="intent" value="review"/>
          <input type="hidden" name="decision" value="usable"/>
          <input type="hidden" name="draftId" value={d.id}/>
          <input type="hidden" name="expectedReviewDigest" value={reviewVersionMap.get(d.id) ?? ""}/>
          <label>Review minutes (optional, self-reported) <input type="number" name="reviewMinutes" min={1} max={240} step={1} style={{width:85}}/></label>
          <label><input type="checkbox" name="reviewed" required/> I inspected the full draft and consider it usable as written</label>
          <button type="submit" disabled={busy}>Record usable review (do not publish)</button>
        </Form>}
        {d.status === "ready" && reviewMap.get(d.id)?.decision === "usable" && reviewMap.get(d.id)?.current && <Form method="post" onSubmit={e => {
          if (!window.confirm("Publish this article immediately to your Shopify store? You must have verified all claims and source links.")) e.preventDefault();
        }}>
          <input type="hidden" name="intent" value="publish"/>
          <input type="hidden" name="draftId" value={d.id}/>
          <input type="hidden" name="expectedPublishDigest" value={publishVersionMap.get(d.id) ?? ""}/>
          <p><strong>Publish destination:</strong> {blogs.find((b: {id:string;title:string}) => b.id === config.blogId)?.title ?? config.blogId} ({config.blogId}) · <strong>Author:</strong> {config.authorName}</p>
          <p><strong>Tags:</strong> {d.tags || "None"} · <strong>Excerpt:</strong> {d.summary}</p>
          <details><summary>Inspect exact article HTML before publishing</summary>
            {previewMap.get(d.id)?.changed && <p role="status">This is a sanitized safety preview, not the exact saved HTML. Edit and renew approval before publishing.</p>}
            {previewMap.get(d.id)?.unavailable ? <p>Preview unavailable. Inspect the original HTML in the draft editor.</p> :
              <div style={{padding:10,border:"1px solid #ddd",maxHeight:400,overflow:"auto"}} dangerouslySetInnerHTML={{__html:previewMap.get(d.id)?.html ?? ""}}/>}
          </details>
          <label><input type="checkbox" name="verified" required/> I have reviewed all facts, links and brand claims</label>
          <button type="submit" disabled={busy}>Publish to Shopify</button>
        </Form>}
        {d.status === "ready" && !(reviewMap.get(d.id)?.decision === "usable" && reviewMap.get(d.id)?.current) && <p>Record a current usable editorial review above before publishing. A structure score alone is not approval.</p>}
        {["ready", "needs_review"].includes(d.status) && !reviewMap.has(d.id) && <Form method="post" style={{display:"flex",gap:8,flexWrap:"wrap",marginTop:8}}>
          <input type="hidden" name="intent" value="reject"/>
          <input type="hidden" name="draftId" value={d.id}/>
          <input type="hidden" name="expectedReviewDigest" value={reviewVersionMap.get(d.id) ?? ""}/>
          <input name="feedback" placeholder="Why is this draft unusable?" required maxLength={1000} style={{flex:1}}/>
          <label>Review minutes (optional) <input type="number" name="reviewMinutes" min={1} max={240} step={1} style={{width:85}}/></label>
          <button type="submit" disabled={busy}>Reject and teach agent</button>
        </Form>}
      </article>)}
    </s-section>
    <s-section heading="Recent generation jobs">
      <ul>{jobs.map(j => <li key={j.id}>{j.topic}: {j.status}{j.error ? " — " + j.error : ""}{j.healthNotice ? " — " + j.healthNotice : ""}</li>)}</ul>
    </s-section>
  </s-page>;
}
export const headers: HeadersFunction = args => boundary.headers(args);
