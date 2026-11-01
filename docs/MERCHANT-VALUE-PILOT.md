# Merchant value pilot: preregistered decision protocol (not activated)

**Status:** Proposed research protocol only. No merchants recruited, no store access, no content published, no revenue or traffic lift measured. This complements `EDITORIAL-METRICS.md` and `EDITORIAL-EDITING.md`; it does not replace the production release gates.

## Primary question and decision

Does the review-first Blog Agent reduce **total merchant labor minutes per independently verified useful draft**, including failed, rejected and abandoned generations, without increasing factual or product-link errors?

Primary unit: a merchant's assigned writing task, **not** a published article. Count all randomized assignments, including tasks never completed. An article's publish status is a separate merchant choice and is never automated for the experiment.

**Treatment:** merchant uses the inactive-until-approved AI drafting and in-app correction workflow in an authorized development/pilot environment. **Control:** merchant drafts the same class of content with their normal editor and workflow. Both arms have the same human editorial and publication rules. Randomize comparable content briefs within each consenting merchant, preferably in matched pairs stratified by topic complexity; keep assignment fixed before writing. Never publish merely for study purposes.

## Measurement contract

- At assignment, record pseudonymous merchant ID, randomized arm, brief ID, complexity stratum, timestamp and whether the merchant is returning. Do not collect buyers, order data, draft text or Google credentials in the study log.
- Capture **active labor time** using merchant-confirmed start/stop sessions for research, writing, editing, verification and publication preparation. Do not equate elapsed wall-clock review time or optional self-reported minutes with actual labor; report missingness separately.
- Independent blinded reviewer scores each submitted draft for factual accuracy, source verifiability, merchant/product relevance, valid product links, originality and usefulness against a rubric fixed before assignment. Reviewer must not see arm, AI metadata or outcome metrics. Require no material factual errors or broken product links to count as useful.
- Record generation/provider cost, credits reserved/refunded, failed/uncertain dispatches, review rework, abandoned tasks and operator interventions. Include all costs in treatment economics, including rejected generations.
- Report completion fraction, useful-draft fraction, total labor per **assigned** brief, labor per useful draft (only when denominator is sufficient), provider dollars per useful draft and severe-error rate. Report uncertainty intervals and merchant-level dispersion; do not silently drop missing time reports or noncompleters.

## Falsifiable go/no-go

A small feasibility cohort (e.g. 5 consenting merchants, 4 paired briefs each) is **not powered to prove revenue or SEO lift**. Use it to validate randomization, time capture, reviewer blinding, costs, consent and workflow usability. Do not call a positive point estimate causal proof at this sample size.

Advance to a larger preregistered evaluation only if (1) no severe factual or unsafe product-link errors escape human review, (2) at least 80% of assigned tasks have complete labor-time evidence, (3) no cross-tenant leakage or unapproved publication occurs, (4) reconciliation and refunds have no unexplained credit losses, and (5) the estimated labor and provider cost per useful draft is directionally better without a material decline in usefulness. Stop and investigate any tenant isolation, privacy, or unapproved publication failure immediately. Treat missingness, dropouts and editorial disagreement as results, not exclusions.

Do **not** use sitewide GSC clicks as a primary endpoint: indexing delays, seasonality, other marketing, topic selection and changing demand confound attribution. Once content is voluntarily published, separately observe page-level GSC impressions, clicks and queries with consent and an explicit pre/post lag, but label this **observational** unless a valid randomized publication design is independently approved. Do not infer revenue without separately consented, defensible conversion measurement.

## Execution and privacy gates

1. Obtain n8n commercial rights and an authorized Shopify development-store installation; keep workflows inactive and publishing manual until then.
2. Obtain explicit merchant research consent, a retention/deletion schedule, blinded reviewer instructions and a signed assignment sheet. Do not export article bodies or buyer data to a research vendor.
3. Freeze rubric, assignment list, thresholds and analysis code **before** the first treatment brief. Record deviations and all excluded/missing records.
4. Run the feasibility study without automatic publishing, marketing messages, billing, store pricing changes or additional app scopes.
5. Publish only aggregate results with denominators, confidence intervals, cost assumptions, missing-data counts and caveats. Merchant-specific results remain private.

**Evidence basis:** [Google Search Central, people-first content](https://developers.google.com/search/docs/fundamentals/creating-helpful-content); [Google Search Console performance metrics and limitations](https://support.google.com/webmasters/answer/7576553); [Shopify blog post editorial workflow](https://help.shopify.com/en/manual/online-store/blogs/writing-blogs/working-with-blog-posts); [n8n licensing](https://support.n8n.io/article/can-i-use-your-license-for-my-use-case). These sources describe platform constraints, not evidence that this product improves outcomes.

## Offline accounting utility (not a live pilot)

Run `python3 -m unittest discover -s tests -p 'test_merchant_value_pilot.py'` and `python3 tools/merchant_value_pilot.py path/to/consented-assignments.csv`. CSV columns: `merchant_id,brief_id,arm,status,labor_minutes,useful,provider_cost_usd`. Use pseudonymous merchant IDs, one row per randomized assignment, arms `ai`/`control`, statuses `completed`/`failed`/`abandoned`, usefulness `0`/`1`, and blank labor for missing evidence. Cost must include all provider charges attributed to the assignment, including failures; if cost is unknown, **do not run the evaluator** until it is reconciled, rather than imputing zero. The script refuses duplicate assignments, invalid statuses and non-finite/negative costs; missing labor suppresses labor-per-useful estimates. Known labor is explicitly a lower bound. This is descriptive accounting, not a hypothesis test, causal effect estimate, or privacy-approved data pipeline. Keep input files outside the repository; do not commit merchant records.

## Assignment-level accounting (2026-11-01)

The offline evaluator also reports completion rate, useful-draft rate **per randomized assignment**, and labor minutes per assigned brief. These include failed and abandoned tasks in the denominator, preventing selective reporting of only successful AI generations. Labor per assigned brief is suppressed whenever any assignment in that arm lacks labor evidence. `accounting_comparison_ready` is true only when both arms have assignments and **100%** labor coverage; it is a data-completeness flag, **not** a pilot pass, causal-effect claim, statistical-significance test, or substitute for the separate 80% feasibility evidence gate. Missing outcomes, merchant clustering, randomization fidelity, quality review, costs and severe errors must still be evaluated independently before any go/no-go decision. A small pilot cannot establish conversion or ranking lift.

## Within-merchant comparison guard (2026-11-01)

The offline accounting flag `accounting_comparison_ready` now requires every represented merchant to have at least one assignment in **each** arm, in addition to complete labor records. It reports `merchants_total` and `merchants_with_both_arms`. Disjoint merchants in AI and control arms can produce misleading pooled differences because merchant skill, product complexity and store characteristics differ. This is a **necessary accounting gate, not sufficient evidence of randomization, balanced brief difficulty, causal identification or statistical power**. A mixed-merchant dataset may still report arm descriptives even when the comparison flag is false. Verify the preregistered within-merchant assignment sheet independently before interpreting any differences.

## Per-merchant assignment balance guard (2026-11-01)

The evaluator additionally reports `merchants_with_balanced_arms` and requires **equal numbers of assigned AI and control briefs for each represented merchant** before setting `accounting_comparison_ready`. Merely having at least one brief in each arm is insufficient: a merchant with two AI briefs and one control brief could distort pooled assignment-weighted comparisons. The guard counts failed and abandoned assignments, not just completed drafts. This does **not** establish matched topic complexity, random assignment, blinded evaluation, or causal effects. Unequal counts remain visible in descriptive summaries, but the comparison gate fails. Verify the frozen assignment sheet and strata independently.

## Continuous integration enforcement (2026-11-01)

The PR's SQLite app-check job now runs `python3 -m unittest discover -s tests -p 'test_merchant*.py' -v` after the Node test suite. This executes both the offline merchant accounting tests and frozen-manifest reconciliation tests. Previously, green Node/PostgreSQL/Docker checks did **not** establish that these Python tools passed: the pilot regressions were not included in CI. This closes that verification gap for code-level checks only; it does not validate a real pilot, randomization, consent, or merchant outcomes. If either Python test module fails, the PR check fails. The PostgreSQL and Docker jobs remain unchanged.
