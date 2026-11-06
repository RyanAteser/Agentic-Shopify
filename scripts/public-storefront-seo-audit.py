#!/usr/bin/env python3
"""Bounded, read-only SEO sampling of public storefront product pages.

This script is NOT a Shopify Admin API integration and MUST NOT be used as
merchant-authorized evidence for any other tenant. It does not update stores,
collect shopper data, or persist HTML.
"""
from __future__ import annotations

import argparse
import ipaddress
import json
import re
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from urllib.error import HTTPError, URLError
from urllib.parse import urljoin, urlsplit, urlunsplit
from urllib.request import HTTPRedirectHandler, Request, build_opener
from urllib.robotparser import RobotFileParser

USER_AGENT = "AgenticShopifyPublicAudit/0.1 (read-only SEO metadata)"
DEFAULT_ORIGIN = "https://monikablunderbeauty.com"
COLLECTION_PATH = "/collections/all-products"
MAX_HTML_BYTES = 1_600_000
MAX_ROBOTS_BYTES = 64_000
TIMEOUT_SECONDS = 18
PRODUCT_PATH_RE = re.compile(r"^/products/[a-z0-9-]+/?$")
TITLE_RANGE = (30, 65)
DESCRIPTION_RANGE = (70, 160)


class SingleHostRedirect(HTTPRedirectHandler):
    def __init__(self, hostname: str):
        super().__init__()
        self.hostname = hostname

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        parsed = urlsplit(newurl)
        if (parsed.scheme != "https" or parsed.hostname != self.hostname or
                parsed.username or parsed.password or parsed.port or parsed.fragment):
            raise ValueError("Redirect outside the permitted HTTPS storefront")
        return super().redirect_request(req, fp, code, msg, headers, newurl)


class SeoDocument(HTMLParser):
    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.title_parts: list[str] = []
        self.h1_count = 0
        self.meta: dict[str, str] = {}
        self.canonical = ""
        self.product_links: list[str] = []
        self.jsonld_scripts: list[str] = []
        self._in_title = False
        self._in_jsonld = False
        self._jsonld_parts: list[str] = []

    def handle_starttag(self, tag: str, attrs):
        item = dict(attrs)
        if tag == "title":
            self._in_title = True
        elif tag == "h1":
            self.h1_count += 1
        elif tag == "meta":
            key = (item.get("name") or item.get("property") or "").lower()
            if key in ("description", "robots", "og:title", "og:description"):
                self.meta[key] = item.get("content") or ""
        elif tag == "link":
            if "canonical" in (item.get("rel") or "").lower().split():
                self.canonical = item.get("href") or ""
        elif tag == "a":
            href = item.get("href") or ""
            if href:
                self.product_links.append(href)
        elif tag == "script":
            self._in_jsonld = (item.get("type") or "").lower().split(";")[0].strip() == "application/ld+json"
            self._jsonld_parts = []

    def handle_data(self, data: str):
        if self._in_title:
            self.title_parts.append(data)
        if self._in_jsonld:
            self._jsonld_parts.append(data)

    def handle_endtag(self, tag: str):
        if tag == "title":
            self._in_title = False
        elif tag == "script" and self._in_jsonld:
            self.jsonld_scripts.append("".join(self._jsonld_parts))
            self._in_jsonld = False
            self._jsonld_parts = []

    @property
    def title(self) -> str:
        return " ".join("".join(self.title_parts).split())


def product_schema_flags(obj) -> tuple[bool, bool]:
    """Recursively search JSON-LD graphs without preserving descriptions."""
    found_product = False
    found_offer = False
    if isinstance(obj, list):
        for value in obj:
            product, offer = product_schema_flags(value)
            found_product |= product
            found_offer |= offer
    elif isinstance(obj, dict):
        types = obj.get("@type", [])
        if isinstance(types, str):
            types = [types]
        if isinstance(types, list) and "Product" in types:
            found_product = True
            found_offer = bool(obj.get("offers"))
        for key in ("@graph", "mainEntity", "itemListElement"):
            if key in obj:
                product, offer = product_schema_flags(obj[key])
                found_product |= product
                found_offer |= offer
    return found_product, found_offer


def storefront_title_matches(rendered: str, expected: str) -> bool:
    """Shopify themes may append a brand suffix after a meaningful delimiter."""
    rendered = " ".join(unescape(rendered).split())
    expected = " ".join(unescape(expected).split())
    if not expected:
        return False
    if rendered == expected:
        return True
    if not rendered.startswith(expected):
        return False
    return bool(re.match(r"^\s+[|\u2013\u2014-]\s+\S", rendered[len(expected):]))


def inspect_metadata(html: str, page_url: str,
                     expected_title: str | None = None,
                     expected_description: str | None = None) -> dict:
    parser = SeoDocument()
    parser.feed(html)
    title = parser.title
    description = " ".join(parser.meta.get("description", "").split())
    canonical = parser.canonical
    robots = parser.meta.get("robots", "")
    flags = set()

    if not title:
        flags.add("missing_title")
    elif len(title) < TITLE_RANGE[0]:
        flags.add("short_title_heuristic")
    elif len(title) > TITLE_RANGE[1]:
        flags.add("long_title_heuristic")

    if not description:
        flags.add("missing_meta_description")
    elif len(description) < DESCRIPTION_RANGE[0]:
        flags.add("short_meta_description_heuristic")
    elif len(description) > DESCRIPTION_RANGE[1]:
        flags.add("long_meta_description_heuristic")

    if parser.h1_count == 0:
        flags.add("missing_h1")
    elif parser.h1_count > 1:
        flags.add("multiple_h1_heuristic")

    if not canonical:
        flags.add("missing_canonical")
    elif urlsplit(canonical)._replace(fragment="", query="").geturl().rstrip("/") != page_url.rstrip("/"):
        flags.add("canonical_differs_from_requested_url")

    if "noindex" in robots.lower():
        flags.add("meta_noindex")

    # Cross-layer observations are more objective than title/description
    # length rules. Expected values must come from the same merchant's
    # authenticated, read-only Shopify Admin export, NEVER from a visitor.
    # Don't retain product descriptions, tokens or raw HTML in the report.
    if expected_title is not None and not storefront_title_matches(title, expected_title):
        flags.add("rendered_title_differs_from_admin")
    if expected_description is not None and (
        description != " ".join(unescape(expected_description).split())
    ):
        flags.add("rendered_description_differs_from_admin")

    product_schema = False
    product_offer = False
    malformed_jsonld = 0
    for data in parser.jsonld_scripts:
        try:
            doc = json.loads(data)
        except (ValueError, TypeError):
            malformed_jsonld += 1
            continue
        product, offer = product_schema_flags(doc)
        product_schema |= product
        product_offer |= offer
    if not product_schema:
        flags.add("missing_product_jsonld_heuristic")

    return {
        "url": page_url,
        "title": title[:140],
        "title_length": len(title),
        "description_length": len(description),
        "canonical": canonical[:300],
        "h1_count": parser.h1_count,
        "product_jsonld": product_schema,
        "product_offer_jsonld": product_offer,
        "malformed_jsonld_scripts": malformed_jsonld,
        "robots_meta": robots[:100],
        "flags": sorted(flags),
    }


def product_urls(html: str, origin: str) -> list[str]:
    parser = SeoDocument()
    parser.feed(html)
    site = urlsplit(origin)
    result: list[str] = []
    seen = set()
    for href in parser.product_links:
        try:
            url = urlsplit(urljoin(origin, href))
        except ValueError:
            continue
        if url.scheme != "https" or url.hostname != site.hostname:
            continue
        if not PRODUCT_PATH_RE.fullmatch(url.path):
            continue
        full = urlunsplit(("https", site.hostname, url.path.rstrip("/"), "", ""))
        if full not in seen:
            result.append(full)
            seen.add(full)
    return result


def fetch(opener, url: str, cap: int = MAX_HTML_BYTES) -> tuple[str, dict]:
    req = Request(url, headers={"User-Agent": USER_AGENT, "Accept": "text/html, text/plain;q=0.5"})
    with opener.open(req, timeout=TIMEOUT_SECONDS) as response:
        if response.status != 200:
            raise RuntimeError(f"Unexpected HTTP {response.status}")
        data = response.read(cap + 1)
        if len(data) > cap:
            raise RuntimeError("Response exceeds bounded audit size")
        content_type = response.headers.get("Content-Type", "").lower()
        return data.decode("utf-8", "replace"), {
            "content_type": content_type,
            "x_robots_tag": response.headers.get("X-Robots-Tag", ""),
        }


def validate_expected_products(origin: str, products: object) -> list[dict[str, str]]:
    """Reject cross-host URLs, malformed manifests and repeated product pages."""
    if not isinstance(products, list) or not 1 <= len(products) <= 24:
        raise ValueError("Expected 1..24 explicitly selected product records")
    host = urlsplit(origin).hostname
    result: list[dict[str, str]] = []
    seen: set[str] = set()
    for record in products:
        if not isinstance(record, dict) or set(record) != {"url", "seoTitle", "seoDescription"}:
            raise ValueError("Expected explicit URL, SEO title and description")
        url, title, desc = record["url"], record["seoTitle"], record["seoDescription"]
        if not all(isinstance(x, str) for x in (url, title, desc)) or (
            len(title) > 500 or len(desc) > 1000
        ):
            raise ValueError("Expected public, bounded text metadata")
        try:
            p = urlsplit(url)
            canonical = urlunsplit(("https", host or "", p.path, "", ""))
        except ValueError as exc:
            raise ValueError("Expected URL malformed") from exc
        if (url != canonical or p.scheme != "https" or p.hostname != host or
                p.username or p.password or p.port or p.query or p.fragment or
                not PRODUCT_PATH_RE.fullmatch(p.path) or p.path.endswith("/") or
                url in seen):
            raise ValueError("Expected product URL must be unique and canonical on primary host")
        seen.add(url)
        result.append(record)
    return result


def run(origin: str, limit: int, delay: float, opener=None,
        expected_products: list[dict[str, str]] | None = None) -> dict:
    parsed = urlsplit(origin)
    if parsed.scheme != "https" or parsed.username or parsed.password or parsed.port or parsed.path not in ("", "/") or not re.fullmatch(r"[a-z0-9.-]+", parsed.hostname or ""):
        raise ValueError("Origin must be a public HTTPS hostname without credentials, port or path")
    hostname = parsed.hostname
    if hostname is None or "." not in hostname or hostname.endswith((".local", ".internal")):
        raise ValueError("A public HTTPS hostname is required")
    try:
        ipaddress.ip_address(hostname)
    except ValueError:
        pass
    else:
        raise ValueError("IP addresses are not permitted audit origins")
    origin = f"https://{hostname}"
    # The manifest is validated before any network request, including robots.
    # A Shopify Admin connector supplies the expected SEO fields separately.
    expected = validate_expected_products(origin, expected_products) if expected_products is not None else None
    expectations = {p["url"]: p for p in expected} if expected is not None else {}
    opener = opener or build_opener(SingleHostRedirect(hostname))

    robots_text, robots_headers = fetch(opener, origin + "/robots.txt", MAX_ROBOTS_BYTES)
    if not robots_headers["content_type"].startswith("text/plain"):
        raise RuntimeError("robots.txt must return plain text")
    robots = RobotFileParser()
    robots.parse(robots_text.splitlines())
    collection_url = None if expected is not None else origin + COLLECTION_PATH
    if expected is not None:
        links = [p["url"] for p in expected]
    else:
        if not robots.can_fetch(USER_AGENT, collection_url):
            raise RuntimeError("robots.txt prohibits reading the collection")
        collection_html, meta = fetch(opener, collection_url)
        if "html" not in meta["content_type"]:
            raise RuntimeError("Collection did not return HTML")
        links = product_urls(collection_html, origin)
        if not links:
            raise RuntimeError("No verified public product URLs found on collection page")
    pages = []
    errors = []
    for url in links[:limit]:
        if not robots.can_fetch(USER_AGENT, url):
            errors.append({"url": url, "error": "Blocked by robots.txt"})
            continue
        time.sleep(delay)
        try:
            html, headers = fetch(opener, url)
            if "html" not in headers["content_type"]:
                raise RuntimeError("Non-HTML product page")
            pinned = expectations.get(url)
            result = inspect_metadata(
                html, url,
                expected_title=pinned["seoTitle"] if pinned else None,
                expected_description=pinned["seoDescription"] if pinned else None,
            )
            if "noindex" in headers["x_robots_tag"].lower():
                result["flags"].append("http_noindex")
            pages.append(result)
        except (HTTPError, URLError, ValueError, RuntimeError, UnicodeError) as exc:
            errors.append({"url": url, "error": type(exc).__name__})
    issue_counts = Counter(flag for page in pages for flag in page["flags"])
    duplicate_title_count = len(pages) - len(set(p["title"].casefold() for p in pages))
    return {
        "audit": "public_html_metadata_with_admin_parity" if expected is not None else "public_html_metadata_only",
        "origin": origin,
        "collection": collection_url,
        "checked_at_utc": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "robots_checked": True,
        "public_product_urls_discovered": len(links),
        "product_urls_selected": min(limit, len(links)),
        "product_pages_inspected": len(pages),
        "products_with_product_jsonld": sum(int(p["product_jsonld"]) for p in pages),
        "products_with_offers_jsonld": sum(int(p["product_offer_jsonld"]) for p in pages),
        "duplicate_title_count_in_sample": duplicate_title_count,
        "flags": dict(sorted(issue_counts.items())),
        "errors": errors,
        "pages": pages,
        "caveats": [
            "Only publicly reachable product HTML; NOT an authenticated Shopify merchant audit.",
            "Metadata-length flags are screening heuristics, not Google's ranking rules.",
            "Passing technical indexing signals is NOT evidence of inclusion in Google's index.",
            "Expected metadata, when supplied, must come from the same merchant's read-only Admin API.",
            "No crawl, indexation, traffic, revenue, or Search Console claims are inferred.",
            "No website changes, credentials, customer information, or full HTML retained.",
        ],
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--origin", default=DEFAULT_ORIGIN, help="Public HTTPS storefront origin")
    parser.add_argument("--limit", type=int, default=12, help="Maximum product URLs (1..24)")
    parser.add_argument("--delay", type=float, default=0.75, help="Delay between product requests (at least 0.5 s)")
    parser.add_argument("--output", type=Path, help="Optional local JSON report path")
    parser.add_argument("--expected-json", type=Path,
                        help="Read-only Admin metadata manifest with products:[{url,seoTitle,seoDescription}]; select exactly these URLs")
    args = parser.parse_args()
    if not 1 <= args.limit <= 24 or not 0.5 <= args.delay <= 5:
        parser.error("Limit must be 1..24 and delay must be 0.5..5 seconds")
    try:
        expected = None
        if args.expected_json:
            if args.expected_json.stat().st_size > 128_000:
                raise ValueError("Expected metadata manifest exceeds size bound")
            obj = json.loads(args.expected_json.read_text(encoding="utf-8"))
            if not isinstance(obj, dict) or set(obj) != {"products"}:
                raise ValueError("Expected manifest must contain only products")
            expected = obj["products"]
        report = run(args.origin, args.limit, args.delay, expected_products=expected)
    except (OSError, json.JSONDecodeError, ValueError, HTTPError, URLError, RuntimeError) as exc:
        print(f"Public SEO audit failed closed: {type(exc).__name__}: {exc}", file=sys.stderr)
        return 2
    text = json.dumps(report, indent=2, ensure_ascii=False)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(text + "\n", encoding="utf-8")
    print(text)
    return 0 if not report["errors"] else 1


if __name__ == "__main__":
    raise SystemExit(main())
