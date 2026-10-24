# Agentic Shopify — Pricing & Unit Economics (proposal, 2026-10-24)

**Status: pricing proposal only.** Billing and subscription enforcement are NOT activated in this branch. No paid merchant plans exist yet.

## Merchants pay for managed content outcomes, not workflow nodes

| Plan | Monthly USD | Draft generations | Positioning | Ship gate |
| --- | ---: | ---: | --- | --- |
| Free | 0 | 3 lifetime | Trial and brand setup | MVP (must implement server-side quota) |
| Starter | 19 | 15/month | Weekly content workflow | Only after end-to-end QA |
| Growth | 39 | 50/month | Shop catalog & performance-led refresh | Requires Search Console + product linking |
| Scale | 99 | 150/month | High-volume operators | Requires robust workflow reliability, reporting & quota enforcement |

- Article generation counts include successful AI drafts; free quota is lifetime. Decide before launch how retries and revisions affect usage and show this transparently to merchants.
- No unlimited tiers. No hidden overages; when exhausted, pause jobs and offer an explicit upgrade or credit-pack purchase.
- Free trial and plan changes must be implemented using Shopify App Pricing (Partner Dashboard) for new public apps.
- Full automation publishing should be a deliberate opt-in only after accurate review, source checking, consistent uptime and Shopify App Store approval. Initial automated action is **create draft**.
- Limit number of active queued jobs and max spending per shop with server-side atomic counters before any paid launch.
- Initial launch should validate **Free + Starter only**; Growth/Scale listed here are feature-conditional hypotheses, not promises.

## Current competitor anchors (US Shopify App Store, checked 2026-10-24)
- AutoBlog AI: $9.99/month, 30 AI articles: https://apps.shopify.com/autoblog-ai-easy-blogging
- Auto Blogs Agent: $12.75/month, 15 AI blogs: https://apps.shopify.com/autopilotseo
- BlogSEO: $19/month, 25 AI blog articles: https://apps.shopify.com/blogseo-ai
- Blogient: from $70/month: https://apps.shopify.com/blogient-ai-blog-writer

## Indicative direct AI spend — scenario only, not measured
Current pipeline is two OpenAI Chat Completions requests, each using `gpt-4.1-mini`, one writer and one editor. OpenAI's official posted rate is $0.40 per 1M input tokens and $1.60 per 1M output tokens as of this review: https://developers.openai.com/api/docs/models/gpt-4.1-mini

For an assumed combined **6,000 input + 6,000 output tokens per generated article**, direct model cost is
`6000/1e6*0.40 + 6000/1e6*1.60 = $0.012` per article (1.2 US cents).
This excludes retries, content research/search APIs, imagery, hallucination checks, storage, Shopify app billing fees, hosting, execution-engine licensing, analytics, and customer support. Do not present this as a measured production COGS.

- Starter 15 drafts × $0.012 = $0.18 monthly *model tokens*.
- Growth 50 drafts × $0.012 = $0.60 monthly *model tokens*.
- Scale 150 drafts × $0.012 = $1.80 monthly *model tokens*.
- These numbers are **not** total service costs; research/enrichment and support may dominate.

## n8n execution costs & commercial constraints

n8n Cloud lists Starter €20/month annually for 2,500 executions and Pro €50/month annually for 10,000 executions (as checked 2026-10-24): https://n8n.io/pricing/
At typical 1 writer execution per article, 100 Growth merchants would consume up to 5,000 writer executions/month, excluding scheduled polling jobs, retries and maintenance. Plan for provisioning and metering.

**Critical:** n8n's Sustainable Use License allows agency/backend operations in some configurations; but giving merchants the ability to create or configure workflows, even through our own interface, requires a commercial agreement. Don't sell or advertise "build your own n8n workflows" under Community Edition. Before shipping generic workflow automation to stores, request written clarification from license@n8n.io or discuss OEM/commercial terms with n8n. References:
- https://support.n8n.io/article/can-i-use-your-license-for-my-use-case
- https://n8n.io/oem/

An internal fixed blogging service accepting merchant *content briefs* appears closer to the documented backend use case, but obtain confirmation; do not assume the proposed self-service schedule/cadence is unambiguously permitted.

## Business validation

Pilot 10–20 merchant stores on the development app. Collect:
- Install → first useful draft conversion; time to first approved post.
- 14-day retention and share of drafts accepted without major edits.
- Real per-article unit economics (token logs + n8n executions + failure retries + any paid data APIs).
- 28/56-day GSC impressions/clicks/position using connected verified properties (long lag; compare similar pages and seasonality).
- Merchant willingness-to-pay interviews and in-product upgrade clicks at $9, $19 and $29. Avoid claiming SEO growth before measuring.

### Revenue sensitivity (gross subscription revenue before fees and costs)
| Paying merchants | $19-only MRR | $39-only MRR | $99-only MRR |
| ---: | ---: | ---: | ---: |
| 25 | $475 | $975 | $2,475 |
| 100 | $1,900 | $3,900 | $9,900 |
| 500 | $9,500 | $19,500 | $49,500 |

### Billing integration plan
Use Shopify App Pricing for public apps, defined in Partner Dashboard (not deployed via this repo alone). Read and enforce merchants' approved subscription entitlements server-side before allocating jobs. Implement atomic usage counters with time windows + refund semantics for failed jobs. Don't let user-supplied forms elevate plan entitlements.
https://shopify.dev/docs/apps/launch/billing

## Positioning hypothesis
"Your Shopify content team that remembers what works" must eventually mean real topic discovery, brand/catalog grounding, source verification, Search Console feedback and content refresh, not just two prompting passes. Compete on merchants publishing fewer but **more useful** articles, not promises of SEO rankings.
