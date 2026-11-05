#!/usr/bin/env python3
"""Offline, fail-closed GSC metadata experiment gate.

No OAuth, merchant API, network requests, billing, Shopify writes or publishing.
A consent/approval flag in an untrusted export is *self-attested*, not
independent proof of merchant authorization. Never present this as causality.
"""
from __future__ import annotations

import argparse
import hashlib
import json
import re
from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import urlsplit
from zoneinfo import ZoneInfo

ROOT = Path(__file__).resolve().parents[1]
PROPOSALS = ROOT / "docs" / "MONIKA-BLUNDER-METADATA-CANDIDATES-2026-11-02.json"
ORIGIN = "https://monikablunderbeauty.com"
STUDY = "monika-public-metadata-20261102-v2"
SALT = "AgenticShopify-public-review/Monika/2026-11-02/v1"
WINDOW_DAYS = 14
MIN_FINALIZATION_LAG_DAYS = 3
MIN_ARM_IMPRESSIONS = 500
MIN_PAGE_IMPRESSIONS = 50
MAX_ABS_PRETREND_PP = 1.0
MIN_MEANINGFUL_REVERSAL_PP = 0.2
MAX_BYTES = 2_000_000


def ymd(s: object) -> date:
    if not isinstance(s, str) or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", s):
        raise ValueError("Expected ISO reporting date")
    d = date.fromisoformat(s)
    if d.isoformat() != s:
        raise ValueError("Noncanonical reporting date")
    return d


def timestamp(s: object) -> datetime:
    if not isinstance(s, str):
        raise ValueError("Expected timezone-aware ISO timestamp")
    x = datetime.fromisoformat(s.replace("Z", "+00:00"))
    if x.tzinfo is None or x.utcoffset() is None:
        raise ValueError("Missing timezone")
    return x


def public_url(value: object) -> str:
    if not isinstance(value, str):
        raise ValueError("Invalid product URL")
    url = urlsplit(value)
    if (url.scheme != "https" or url.netloc != "monikablunderbeauty.com" or
            not re.fullmatch(r"/products/[a-z0-9-]+", url.path) or
            url.query or url.fragment or url.username or url.password or url.port):
        raise ValueError("Product outside exact public study origin")
    return value


def plan(proposal_path: Path = PROPOSALS) -> dict:
    raw = json.loads(proposal_path.read_text("utf-8"))
    if (raw.get("report_type") != "public_storefront_editorial_proposals" or
        raw.get("source_host") != "monikablunderbeauty.com" or
        raw.get("merchant_authorized") is not False or
        raw.get("modified_store") is not False):
        raise ValueError("This plan requires unapproved, unmodified public research")
    records = raw.get("proposals")
    if not isinstance(records, list) or len(records) != 6:
        raise ValueError("Expected six preregistered public candidates")
    urls = [public_url(item.get("url")) for item in records]
    if len(set(urls)) != 6 or any(item.get("status") != "UNAPPROVED_PUBLIC_RESEARCH" for item in records):
        raise ValueError("Duplicate URLs or non-research proposals")
    ranked = sorted(urls, key=lambda url: hashlib.sha256((SALT + "|" + url).encode()).hexdigest())
    return {
        "studyId": STUDY,
        "property": ORIGIN + "/",
        "status": "WITHHELD_NO_AUTHORIZED_INTERVENTION_OR_GSC_DATA",
        "allocation": {
            "method": "preregistered_deterministic_hash_order",
            "hashSeedDescription": SALT,
            "treatmentUrls": ranked[:3],
            "delayedControlUrls": ranked[3:],
            "interventionExecuted": False,
            "merchantAuthorization": False,
        },
        "preRegisteredWindow": {
            "preDays": WINDOW_DAYS, "postDays": WINDOW_DAYS,
            "excludeChangeDate": True,
            "gscFinalizationLagDays": MIN_FINALIZATION_LAG_DAYS,
            "minArmImpressionsEachPeriod": MIN_ARM_IMPRESSIONS,
            "minPageImpressionsEachPeriod": MIN_PAGE_IMPRESSIONS,
            "maxAbsPretrendPercentagePoints": MAX_ABS_PRETREND_PP,
            "minMixReversalMagnitudePercentagePoints": MIN_MEANINGFUL_REVERSAL_PP,
            "gscSearchType": "web", "gscDimensions": ["date", "page"],
            "gscAggregation": "byPage", "gscDataState": "final",
        },
        "outcome": None,
        "note": "Prospective allocation only. No third-party merchant approval, metadata edit or consented Search Console export. Do not claim an SEO effect.",
    }


def _sum(rows: list[dict], urls: set[str], start: date, stop: date) -> tuple[int, int]:
    selected = [r for r in rows if r["url"] in urls and start <= r["date"] <= stop]
    return (sum(r["clicks"] for r in selected), sum(r["impressions"] for r in selected))


def evaluate(raw: object, planning: dict, now: datetime | None = None) -> dict:
    """Return descriptive effects only after strict evidence validation.

    Missing dates are never interpreted as zero. GSC truncates query rows,
    and page-only CTR is confounded by query/device/position composition.
    """
    withheld = lambda why: {
        "studyId": STUDY, "status": "withheld", "reason": why,
        "outcome": None, "causalImpactProven": False,
    }
    if not isinstance(raw, dict) or set(raw) != {"studyId", "authorization", "changeLog", "export"}:
        return withheld("invalid_evidence_contract")
    if raw["studyId"] != STUDY:
        return withheld("wrong_study")
    auth = raw["authorization"]
    change = raw["changeLog"]
    export = raw["export"]
    if not all(isinstance(x, dict) for x in (auth, change, export)):
        return withheld("invalid_evidence_contract")
    if (auth.get("merchantConsented") is not True or
        auth.get("propertyVerified") is not True or
        auth.get("permissionLevel") not in {"siteOwner", "siteFullUser"} or
        auth.get("siteUrl") != planning["property"]):
        return withheld("merchant_consent_and_verified_property_required")
    if (change.get("merchantApproved") is not True or
        change.get("changesApplied") is not True or
        change.get("controlUnchanged") is not True or
        change.get("treatmentUrls") != planning["allocation"]["treatmentUrls"] or
        change.get("controlUrls") != planning["allocation"]["delayedControlUrls"]):
        return withheld("approved_treatment_and_unchanged_controls_required")
    try:
        consent_at = timestamp(auth.get("consentedAt"))
        changed_at = timestamp(change.get("changedAt"))
        exported_at = timestamp(export.get("exportedAt"))
        if not consent_at <= changed_at < exported_at:
            return withheld("invalid_consent_or_intervention_order")
        change_day = changed_at.astimezone(ZoneInfo("America/Los_Angeles")).date()
        export_day = exported_at.astimezone(ZoneInfo("America/Los_Angeles")).date()
        current = now or datetime.now(ZoneInfo("America/Los_Angeles"))
        if exported_at > current + timedelta(minutes=5):
            return withheld("future_export")
        pre_start = change_day - timedelta(days=WINDOW_DAYS)
        pre_end = change_day - timedelta(days=1)
        post_start = change_day + timedelta(days=1)
        post_end = change_day + timedelta(days=WINDOW_DAYS)
        if post_end > export_day - timedelta(days=MIN_FINALIZATION_LAG_DAYS):
            return withheld("await_final_gsc_data")
        all_urls = set(planning["allocation"]["treatmentUrls"] + planning["allocation"]["delayedControlUrls"])
        # Each page must have its own equality-filtered Search Analytics query,
        # then be normalized into the page/date row format below. This avoids
        # silently cherry-picking 6 rows from a truncated property-wide export.
        if (export.get("siteUrl") != planning["property"] or
            export.get("searchType") != "web" or
            export.get("dataState") != "final" or
            export.get("responseAggregationType") != "byPage" or
            export.get("dimensions") != ["date", "page"] or
            export.get("completePagination") is not True or
            export.get("pageEqualsFilters") != sorted(all_urls) or
            export.get("startDate") != pre_start.isoformat() or
            export.get("endDate") != post_end.isoformat() or
            export.get("noAdditionalFilters") is not True):
            return withheld("gsc_export_scope_or_pagination_invalid")
        rows = export.get("rows")
        if not isinstance(rows, list) or len(rows) > 6 * (WINDOW_DAYS * 2 + 1):
            return withheld("invalid_or_excess_rows")
        required_days = {pre_start + timedelta(days=k) for k in range(WINDOW_DAYS)}
        required_days |= {post_start + timedelta(days=k) for k in range(WINDOW_DAYS)}
        allowed_days = required_days | {change_day}
        seen: set[tuple[str, date]] = set()
        observed = []
        for row in rows:
            if not isinstance(row, dict) or set(row) != {"keys", "clicks", "impressions"}:
                return withheld("invalid_gsc_row")
            keys = row["keys"]
            if not isinstance(keys, list) or len(keys) != 2:
                return withheld("invalid_gsc_row")
            day = ymd(keys[0])
            url = public_url(keys[1])
            if url not in all_urls or day not in allowed_days or (url, day) in seen:
                return withheld("unexpected_duplicate_or_out_of_scope_row")
            clicks, impressions = row["clicks"], row["impressions"]
            if not (type(clicks) is int and type(impressions) is int and
                    0 <= clicks <= impressions <= 1_000_000_000):
                return withheld("invalid_gsc_counts")
            seen.add((url, day))
            if day != change_day:
                observed.append({"url": url, "date": day, "clicks": clicks, "impressions": impressions})
        # GSC can omit days without exposure or privacy-filter observations.
        # Incomplete exports never become fabricated zero-click days.
        if {(u, d) for u, d in seen if d != change_day} != {
            (u, d) for u in all_urls for d in required_days
        }:
            return withheld("incomplete_page_day_coverage")
        treatment = set(planning["allocation"]["treatmentUrls"])
        control = set(planning["allocation"]["delayedControlUrls"])
        btc, bti = _sum(observed, treatment, pre_start, pre_end)
        atc, ati = _sum(observed, treatment, post_start, post_end)
        bcc, bci = _sum(observed, control, pre_start, pre_end)
        acc, aci = _sum(observed, control, post_start, post_end)
        if min(bti, ati, bci, aci) < MIN_ARM_IMPRESSIONS:
            return withheld("insufficient_impressions")
        # A single high-volume product cannot stand in for all three pages.
        # Reject zero/very low exposure rather than imputing zero CTR changes.
        page_stats = {}
        for url in sorted(all_urls):
            bc, bi = _sum(observed, {url}, pre_start, pre_end)
            ac, ai = _sum(observed, {url}, post_start, post_end)
            if min(bi, ai) < MIN_PAGE_IMPRESSIONS:
                return withheld("insufficient_page_exposure")
            page_stats[url] = (bc, bi, ac, ai)
        before_t = btc / bti
        after_t = atc / ati
        before_c = bcc / bci
        after_c = acc / aci
        # Not causal: page/query mix, position and external events are uncontrolled.
        effect = (after_t - before_t) - (after_c - before_c)
        half = WINDOW_DAYS // 2
        first_end = pre_start + timedelta(days=half - 1)
        second_start = first_end + timedelta(days=1)
        t1c, t1i = _sum(observed, treatment, pre_start, first_end)
        t2c, t2i = _sum(observed, treatment, second_start, pre_end)
        c1c, c1i = _sum(observed, control, pre_start, first_end)
        c2c, c2i = _sum(observed, control, second_start, pre_end)
        pretrend_pp = ((t2c / t2i - t1c / t1i) -
                       (c2c / c2i - c1c / c1i)) * 100 if min(t1i, t2i, c1i, c2i) else None
        if pretrend_pp is None or abs(pretrend_pp) > MAX_ABS_PRETREND_PP:
            return withheld("unstable_pre_intervention_trend")

        # Simpson's paradox guard: compute within-page CTR changes using each
        # arm's BASELINE page impression weights. Pooling all post impressions
        # without this check can create apparent lift solely through a change
        # in exposure mix among the three products.
        def fixed_mix_change(urls: set[str]) -> float:
            before_exposure = sum(page_stats[u][1] for u in urls)
            return sum(
                (page_stats[u][1] / before_exposure) *
                (page_stats[u][2] / page_stats[u][3] -
                 page_stats[u][0] / page_stats[u][1])
                for u in urls
            )
        fixed_mix_did = fixed_mix_change(treatment) - fixed_mix_change(control)
        raw_effect_pp = effect * 100
        fixed_effect_pp = fixed_mix_did * 100
        if (raw_effect_pp * fixed_effect_pp < 0 and
            min(abs(raw_effect_pp), abs(fixed_effect_pp)) >= MIN_MEANINGFUL_REVERSAL_PP):
            return withheld("exposure_mix_sign_reversal")
        return {
            "studyId": STUDY, "status": "descriptive_only",
            "authorization": "self_attested_not_independently_verified",
            "window": {"preStart": pre_start.isoformat(), "preEnd": pre_end.isoformat(),
                       "postStart": post_start.isoformat(), "postEnd": post_end.isoformat()},
            "treatment": {"beforeCtr": before_t, "afterCtr": after_t, "beforeClicks": btc,
                          "afterClicks": atc, "beforeImpressions": bti, "afterImpressions": ati},
            "control": {"beforeCtr": before_c, "afterCtr": after_c, "beforeClicks": bcc,
                        "afterClicks": acc, "beforeImpressions": bci, "afterImpressions": aci},
            "differenceInDifferencesPercentagePoints": raw_effect_pp,
            "fixedBaselinePageMixDifferencePercentagePoints": fixed_effect_pp,
            "pageMixDifferencePercentagePoints": raw_effect_pp - fixed_effect_pp,
            "descriptiveOnly": True,
            "pretrendDifferencePercentagePoints": pretrend_pp,
            "causalImpactProven": False, "statisticalSignificanceEstablished": False,
            "note": "Pooled and fixed-baseline-page-mix comparisons are descriptive only. Query/device mix within pages, SERP position, selection and timing remain confounded. No causal SEO effect, significance or revenue lift established.",
        }
    except (ValueError, TypeError, OverflowError, KeyError):
        return withheld("invalid_gsc_evidence")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--evaluate", type=Path, help="Optional authorized offline evidence JSON; never fetches private GSC data")
    parser.add_argument("--output", type=Path, help="Optional path for the evaluation result")
    args = parser.parse_args()
    planning = plan()
    if args.evaluate:
        if args.evaluate.stat().st_size > MAX_BYTES:
            parser.error("Evidence file exceeds 2 MB")
        result = evaluate(json.loads(args.evaluate.read_text("utf-8")), planning)
    else:
        result = planning
    output = json.dumps(result, indent=2, ensure_ascii=False) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(output, encoding="utf-8")
    print(output, end="")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
