#!/usr/bin/env python3
"""Validate unapproved public SEO copy proposals; optionally recheck metadata.

This is NOT a merchant integration. No Shopify credentials, Admin API calls,
write requests, publication, or live content changes are implemented.
"""
from __future__ import annotations

import argparse
import hashlib
import importlib.util
import json
import re
import sys
import time
from pathlib import Path
from urllib.robotparser import RobotFileParser

ROOT = Path(__file__).resolve().parents[1]
DATA = ROOT / "docs" / "MONIKA-BLUNDER-METADATA-CANDIDATES-2026-11-02.json"
HOST = "monikablunderbeauty.com"
SLUGS = {
    "architect-eyes-buildable-mascara",
    "melt-down-cleansing-balm",
    "flawless-finish-essentials-kit",
    "skincare-essentials",
    "sweet-talk-lip-oil",
    "point-taken-pencil-sharpener",
}


def load_and_validate(path: Path = DATA) -> list[dict]:
    document = json.loads(path.read_text(encoding="utf-8"))
    if document.get("report_type") != "public_storefront_editorial_proposals":
        raise ValueError("Not the expected public SEO proposal report")
    if document.get("source_host") != HOST:
        raise ValueError("Candidate report targets an unexpected host")
    if any(document.get(flag) is not False for flag in (
        "merchant_authorized", "modified_store", "seo_performance_improvement_proven"
    )):
        raise ValueError("Unapproved public research must never assert authorization, changes or proven lift")

    proposals = document.get("proposals")
    if not isinstance(proposals, list) or len(proposals) != len(SLUGS):
        raise ValueError("Expected exactly six public-page proposals")
    seen = set()
    for item in proposals:
        if not isinstance(item, dict):
            raise ValueError("Malformed proposal")
        slug = item.get("product_slug")
        if slug not in SLUGS or slug in seen:
            raise ValueError("Unrecognized or duplicate product slug")
        seen.add(slug)
        if item.get("url") != f"https://{HOST}/products/{slug}":
            raise ValueError("Public canonical URL mismatch")
        if item.get("status") != "UNAPPROVED_PUBLIC_RESEARCH":
            raise ValueError("Proposal status must remain unapproved")
        copy = item.get("proposed_meta_description")
        if not isinstance(copy, str) or len(copy) < 90 or len(copy) > 155:
            raise ValueError("Draft length outside editorial bounds")
        if copy != copy.strip() or any(ord(ch) < 32 for ch in copy):
            raise ValueError("Draft contains whitespace/control anomalies")
        if item.get("proposed_length") != len(copy):
            raise ValueError("Draft length inconsistent with its text")
        if "$" in copy or "save " in copy.casefold() or "guaranteed" in copy.casefold():
            raise ValueError("Draft must not claim pricing, savings or guarantees")
        old_len = item.get("original_meta_description_length")
        if not isinstance(old_len, int) or old_len <= 160:
            raise ValueError("Original page did not trigger the stated long-description review")
        sha = item.get("original_meta_description_sha256")
        if not isinstance(sha, str) or not re.fullmatch(r"[0-9a-f]{64}", sha):
            raise ValueError("Missing exact original metadata fingerprint")
        basis = item.get("claim_basis_on_public_product_page")
        if not isinstance(basis, list) or not basis or not all(
            isinstance(b, str) and b.strip() for b in basis
        ):
            raise ValueError("Proposal is missing product-specific claim provenance")
        if "approve" not in (item.get("review_required") or "").casefold():
            raise ValueError("Human approval must be explicit")
    return proposals


def recheck_live(proposals: list[dict]) -> None:
    """A consciously requested, bounded GET-only check for stale source HTML."""
    source = ROOT / "scripts" / "public-storefront-seo-audit.py"
    spec = importlib.util.spec_from_file_location("public_storefront_audit", source)
    if spec is None or spec.loader is None:
        raise RuntimeError("Could not load public SEO fetch safety checks")
    audit = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(audit)

    origin = f"https://{HOST}"
    opener = audit.build_opener(audit.SingleHostRedirect(HOST))
    robots_text, meta = audit.fetch(opener, origin + "/robots.txt", audit.MAX_ROBOTS_BYTES)
    if not meta["content_type"].startswith("text/plain"):
        raise RuntimeError("Unexpected robots.txt content type")
    robots = RobotFileParser()
    robots.parse(robots_text.splitlines())

    for item in proposals:
        url = item["url"]
        if not robots.can_fetch(audit.USER_AGENT, url):
            raise RuntimeError("Blocked by robots.txt: " + item["product_slug"])
        time.sleep(0.7)
        html, headers = audit.fetch(opener, url)
        if "html" not in headers["content_type"]:
            raise RuntimeError("Not an HTML product page: " + item["product_slug"])
        parsed = audit.SeoDocument()
        parsed.feed(html)
        current = " ".join(parsed.meta.get("description", "").split())
        current_sha = hashlib.sha256(current.encode("utf-8")).hexdigest()
        if current_sha != item["original_meta_description_sha256"] or len(current) != item["original_meta_description_length"]:
            raise RuntimeError("STALE proposal: source metadata changed for " + item["product_slug"])
        if parsed.canonical != url:
            raise RuntimeError("Source canonical changed for " + item["product_slug"])
        print("SOURCE_UNCHANGED", item["product_slug"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--file", type=Path, default=DATA)
    parser.add_argument("--check-live", action="store_true", help="Explicitly re-fetch six public product pages")
    opts = parser.parse_args()
    try:
        records = load_and_validate(opts.file)
        print(f"PASS: {len(records)} unapproved public SEO proposals satisfy review constraints")
        if opts.check_live:
            recheck_live(records)
            print("PASS: public source metadata fingerprints and canonicals unchanged")
    except (OSError, ValueError, RuntimeError) as exc:
        print(f"REVIEW_CHECK_FAILED: {exc}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
