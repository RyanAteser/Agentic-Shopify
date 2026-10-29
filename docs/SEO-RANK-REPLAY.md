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
- `confirmedEarlierIncidents`, `confirmedLaterIncidents` and
  `sameDayIncidents` compare each shared incident's **first alert UTC date**.
  `medianConfirmedLagDays` is signed: positive means the three-day rule
  first flagged later; negative means it flagged earlier; null means no
  shared incidents. It is a median of UTC calendar-day differences, not
  wall-clock alert latency or time until a merchant sees an alert.

In the fictional six-observation fixture, the reference has two incident-days
and the three-day rule one. They have **zero same-day overlap**, but share
**one incident**, first detected **one UTC day later** by the three-day rule.
The second reference-only incident is same-day scrape noise in the fixture,
not a proven real-world false positive. This comparison does not model
merchant dismissals, actual task creation or delayed scraping schedules.

The output counts incident-days and deduplicated market/page incidents.
A labeled-usefulness percentage is emitted only when at least one incident
has a human label, with labeled and unlabeled denominators disclosed. This
is **not population precision** when labels are selectively collected.
The evaluator does not reproduce Store Manager's persistent dismissal or
supersession lifecycle, and cannot prove which incidents cost merchants time.

Before launch, obtain a consented, provenance-checked Bright Data export and
independent labels, freeze a time split, and compare alert usefulness and
missed material traffic declines. A useful alert should be supported by a
relevant Search Console decline or verified merchant action, not SERP
movement alone. If the stricter rule misses material incidents or its
usefulness rate fails to improve, revise or reject it. Do not change a live
store, buy SERP requests, publish content or activate workflows for this test.

Google's official guidance: https://developers.google.com/search/docs/monitor-debug/debugging-search-traffic-drops
Google Search Analytics API: https://developers.google.com/webmaster-tools/v1/searchanalytics/query
