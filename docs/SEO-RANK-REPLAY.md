# Offline SEO ranking-alert replay (research tool)

This read-only evaluator compares the current three-distinct-UTC-day Store Manager
ranking alert with a **naive two-snapshot reference**. It is not an exact replay
of historical production code, a rank-tracking service, or a claim of SEO lift.

## Run on a consented, single-store export

Save one local JSON file with the exact format below. Values are **fictional examples**:

    {
      "primaryHost": "shop.example",
      "observations": [
        {"keyword":"boots","country":"US","device":"desktop","engine":"google",
         "targetUrl":"https://shop.example/products/boots","position":4,
         "observedAt":"2026-10-23T12:00:00Z"},
        {"keyword":"boots","country":"US","device":"desktop","engine":"google",
         "targetUrl":"https://shop.example/products/boots","position":9,
         "observedAt":"2026-10-24T12:00:00Z"},
        {"keyword":"boots","country":"US","device":"desktop","engine":"google",
         "targetUrl":"https://shop.example/products/boots","position":11,
         "observedAt":"2026-10-25T12:00:00Z"}
      ],
      "labels": [
        {"keyword":"boots","country":"US","device":"desktop","engine":"google",
         "targetUrl":"https://shop.example/products/boots","useful":true}
      ]
    }

Run:

    npx tsx scripts/seo-rank-replay.ts authorized-shop-export.json

The optional "labels" must come from independent, human-reviewed evidence.
Do not label an alert "useful" merely because its SERP position fell.
Corroborate Google incidents with Search Console clicks/impressions and
check seasonal demand, indexing, market/device and search appearance. For Bing,
use Bing Webmaster Tools rather than Google Search Console.

The evaluator checks the same domain for all found-result URLs, strict
timestamp and market fields, duplicate snapshots, unknown/duplicate labels,
a maximum of 5,000 observations and a 2 MB input file. It accepts at most
365 days of history and does not upload, print or store raw merchant queries
or URLs. Run it locally on authorized data; avoid committing exports.

## Interpretation and falsification

Each UTC calendar date with a scrape is an end-of-day checkpoint. A market
without a scrape that day contributes no new alert. The reference flags a
three-position loss between its last two snapshots, even if those were minutes
apart. The current algorithm requires three distinct UTC dates, same page,
a three-position decline on both later days, and no contradictory intraday
scrapes on those two days. Both can emit an alert on different dates. Report
"reference-only", "confirmed-only" and "both" incident-days separately;
do not call their difference a false-positive reduction.

## Paired incident timing (2026-10-28)

The first replay reported only **same-day overlap**. This can be misleading:
a two-snapshot rule might flag a keyword on Tuesday and the three-day rule
flag the **same landing-page incident** on Wednesday. That yields zero shared
incident-days despite detecting the same incident. We now report both views:

- `referenceOnlyIncidentDays`, `confirmedOnlyIncidentDays` and
  `bothIncidentDays` compare **exact UTC date + incident identity**.
- `referenceOnlyIncidents`, `confirmedOnlyIncidents` and
  `bothIncidents` compare **stable market/page identity across all dates**.
- `referenceOnlyEpisodes`, `confirmedOnlyEpisodes` and `bothEpisodes`
  distinguish recurring sampled declines on the same market/page. An episode
  ends when an observed rank returns to within two positions of the pre-drop
  best rank; a page change, missing result or gap exceeding 28 days also
  starts a new comparison episode. These boundaries are based on observed
  scrapes, **not verified traffic recoveries**. They are computed
  chronologically, without future observations.
- `confirmedEarlierEpisodes`, `confirmedLaterEpisodes` and
  `sameDayEpisodes` compare the **first alert UTC date per shared episode**.
  `medianConfirmedEpisodeLagDays` is signed: positive means the three-day
  rule first flagged later; negative means earlier; null means no shared
  episodes. It is not wall-clock delivery latency or merchant response time.
  A stable market/page incident can contain multiple episodes, so using
  only its first-ever alert would hide recurrence or pair unrelated drops.

In the fictional six-observation fixture, the reference has two incident-days
and the three-day rule one. They have **zero same-day overlap**, but share
**one incident**, first detected **one UTC day later** by the three-day rule.
The second reference-only incident is same-day scrape noise in the fixture,
not a proven real-world false positive. This comparison does not model
merchant dismissals, actual task creation or delayed scraping schedules.

The output counts incident-days, stable market/page incidents, and separately
sampled decline episodes. A labeled-usefulness percentage is emitted only when
at least one **stable incident identity** has a human label, with labeled and
unlabeled denominators disclosed. A label is **not episode-specific** and must
not be interpreted as independent confirmation of recurring declines. This is
**not population precision** when labels are selectively collected.
The evaluator does not reproduce Store Manager's persistent dismissal or
supersession lifecycle, and cannot prove which incidents cost merchants time.

Before launch, obtain a consented, provenance-checked Bright Data export and
independent labels, freeze a time split, and compare alert usefulness and
missed material traffic declines. A useful alert should be supported by a
relevant Search Console decline or verified merchant action, not SERP
movement alone. If the stricter rule misses material incidents or its
usefulness rate fails to improve, revise or reject it. Do not change a live
store, buy SERP requests, publish content or activate workflows for this test.


## Repeated declines and evaluation leakage (2026-10-28)

A page can fall, recover, and fall again during one 365-day export. The old
first-alert comparison collapsed both episodes into one stable incident and
measured only the first pair of detection dates. This undercounted repeated
problems and could mask the delay on later recurrences. The evaluator now
keeps stable incident totals for compatibility but computes **episode-aware**
first-alert lag separately. For example, the fictional sequence
4 → 9 → 11 → 4 → 9 → 11 on six distinct days contains one market/page
identity but **two observed decline episodes**. Both algorithms flag both
in this fixture, with the three-day rule detecting each one UTC day later.

Episode boundaries are heuristics, not ground truth: sparse scrapes can miss
recoveries, temporary rank rebounds can split a sustained traffic problem,
and an unknown result or changed page only establishes lost comparability.
Do not use episode counts as conversion outcomes or infer causal SEO impact.
A future merchant study needs independently adjudicated **episode-level**
labels, dated GSC evidence, and a frozen holdout period. Google Search
Console's API is row-limited and privacy-filters some query-level data;
it also uses Pacific reporting dates, so its aggregate positions cannot be
directly equated to UTC point-in-time SERP snapshots. See:
https://developers.google.com/webmaster-tools/v1/searchanalytics/query
https://developers.google.com/search/blog/2022/10/performance-data-deep-dive

Google's official guidance: https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops
Google Search Analytics API: https://developers.google.com/webmaster-tools/v1/searchanalytics/query

## Retrospective Google Search Console corroboration

A separate **offline-only** evaluator now validates exact, consented Google Search Console query/page/country/device evidence for one Google SERP incident and compares the seven Pacific reporting days before versus after it. It rejects cross-store properties and broad or mismatched cohorts, and abstains when daily query rows are missing rather than fabricating zero traffic. This is descriptive, retrospective evidence, **not** a real merchant result or causal confirmation of a ranking alert. See [GSC-RANK-EVIDENCE.md](./GSC-RANK-EVIDENCE.md) for the export contract, local CLI, privacy constraints and limitations. This does not change production alert generation.
