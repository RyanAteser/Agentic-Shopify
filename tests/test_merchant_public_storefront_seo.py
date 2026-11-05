"""Offline regression tests for the read-only public SEO sampler."""
import importlib.util
import json
import sys
import unittest
from pathlib import Path
from unittest.mock import patch

SCRIPT = Path(__file__).resolve().parents[1] / "scripts" / "public-storefront-seo-audit.py"
spec = importlib.util.spec_from_file_location("public_seo_audit", SCRIPT)
assert spec and spec.loader
audit = importlib.util.module_from_spec(spec)
sys.modules[spec.name] = audit
spec.loader.exec_module(audit)

HOST = "https://monikablunderbeauty.com"
PRODUCT = HOST + "/products/blunder-cover"

def page(title, description, canonical=PRODUCT, h1=True, product_schema=True):
    ld = ('<script type="application/ld+json">' +
          json.dumps({"@context": "https://schema.org", "@type": "Product",
                      "name": "Blunder Cover", "offers": {"@type": "Offer", "price": "52"}}) +
          "</script>") if product_schema else ""
    return (
        '<html><head><title>' + title + '</title>' +
        '<meta name="description" content="' + description + '">' +
        '<link rel="canonical" href="' + canonical + '">' +
        ld + '</head><body>' +
        ('<h1>Blunder Cover</h1>' if h1 else '') + '</body></html>'
    )

class FakeResponse:
    def __init__(self, body, content_type):
        self.body = body.encode("utf-8")
        self.status = 200
        self.headers = {"Content-Type": content_type}
    def __enter__(self): return self
    def __exit__(self, *_): return False
    def read(self, max_size): return self.body[:max_size]

class FakeOpener:
    def __init__(self, responses):
        self.responses = responses
        self.visited = []
    def open(self, request, timeout=0):
        self.visited.append(request)
        assert request.get_method() == "GET", "Audit must never send writes"
        assert request.headers.get("User-agent", "").startswith("AgenticShopifyPublicAudit/")
        return self.responses[request.full_url]

class PublicSeoAuditTests(unittest.TestCase):
    def test_product_link_selection_stays_on_public_shop_and_deduplicates(self):
        html = '''<a href="/products/blunder-cover?variant=123">one</a>
          <a href="/products/blunder-cover">dup</a>
          <a href="https://other.example/products/not-ours">outsider</a>
          <a href="//127.0.0.1/products/unsafe">local</a>
          <a href="/products/sweet-talk-lip-oil#variant">two</a>
          <a href="/admin/products/123">admin</a>'''
        self.assertEqual(audit.product_urls(html, HOST), [
            PRODUCT, HOST + "/products/sweet-talk-lip-oil",
        ])

    def test_complete_product_metadata_is_inspected_without_retain_html(self):
        doc = page("Blunder Cover Foundation and Concealer | Monika Blunder Beauty",
                   "A" * 100)
        result = audit.inspect_metadata(doc, PRODUCT)
        self.assertEqual(result["h1_count"], 1)
        self.assertTrue(result["product_jsonld"])
        self.assertTrue(result["product_offer_jsonld"])
        self.assertEqual(result["canonical"], PRODUCT)
        self.assertEqual(result["description_length"], 100)
        self.assertNotIn("A" * 100, str(result))
        self.assertNotIn("missing_product_jsonld_heuristic", result["flags"])

    def test_heuristics_mark_missing_fields_and_disallowed_indexing(self):
        doc = '<html><head><meta name="robots" content="noindex, follow"></head><body></body></html>'
        result = audit.inspect_metadata(doc, PRODUCT)
        self.assertTrue({"missing_title", "missing_meta_description", "missing_h1",
                         "missing_canonical", "missing_product_jsonld_heuristic",
                         "meta_noindex"}.issubset(result["flags"]))

    def test_canonical_mismatch_is_flagged_without_changing_source(self):
        result = audit.inspect_metadata(
            page("Foundation and Concealer | Monika Blunder",
                 "B" * 100, canonical=HOST + "/products/other"), PRODUCT)
        self.assertIn("canonical_differs_from_requested_url", result["flags"])

    def test_malformed_jsonld_is_not_assumed_valid(self):
        doc = page("Blunder Cover Foundation and Concealer | Monika",
                   "B" * 100, product_schema=False).replace(
            "</head>", '<script type="application/ld+json">{oops</script></head>')
        result = audit.inspect_metadata(doc, PRODUCT)
        self.assertEqual(result["malformed_jsonld_scripts"], 1)
        self.assertFalse(result["product_jsonld"])

    def test_only_explicit_readonly_public_urls_requested(self):
        docs = {
            HOST + "/robots.txt": FakeResponse("User-agent: *\\nAllow: /".replace("\\n", "\n"), "text/plain"),
            HOST + "/collections/all-products": FakeResponse(
                '<a href="/products/blunder-cover">Product</a>', "text/html"),
            PRODUCT: FakeResponse(page("Blunder Cover Foundation and Concealer | Monika",
                                       "C" * 100), "text/html"),
        }
        opener = FakeOpener(docs)
        with patch.object(audit.time, "sleep", return_value=None):
            result = audit.run(HOST, 1, 0.5, opener=opener)
        self.assertEqual(result["public_product_urls_discovered"], 1)
        self.assertEqual(result["product_pages_inspected"], 1)
        self.assertEqual(result["errors"], [])
        self.assertEqual([req.full_url for req in opener.visited],
                         [HOST + "/robots.txt", HOST + "/collections/all-products", PRODUCT])

    def test_non_public_and_non_https_origins_fail_before_network(self):
        for origin in ("http://example.com", "https://localhost",
                       "https://127.0.0.1", "https://169.254.169.254",
                       "https://example.internal", "https://example.com:8443",
                       "https://example.com/auth", "https://admin:secret@example.com"):
            with self.subTest(origin=origin):
                with self.assertRaises(ValueError):
                    audit.run(origin, 1, 0.5, opener=FakeOpener({}))

    def test_robots_txt_must_be_plain_text(self):
        opener = FakeOpener({
            HOST + "/robots.txt": FakeResponse("<html>Not robots</html>", "text/html"),
        })
        with self.assertRaisesRegex(RuntimeError, "robots.txt must return plain text"):
            audit.run(HOST, 1, 0.5, opener=opener)
        self.assertEqual([r.full_url for r in opener.visited], [HOST + "/robots.txt"])

    def test_robots_disallow_prevents_product_request(self):
        opener = FakeOpener({
            HOST + "/robots.txt": FakeResponse(
                "User-agent: *\\nDisallow: /products/".replace("\\n", "\n"), "text/plain"),
            HOST + "/collections/all-products": FakeResponse(
                '<a href="/products/blunder-cover">Product</a>', "text/html"),
        })
        result = audit.run(HOST, 1, 0.5, opener=opener)
        self.assertEqual(result["product_pages_inspected"], 0)
        self.assertEqual(result["errors"][0]["error"], "Blocked by robots.txt")
        self.assertEqual(len(opener.visited), 2, "Must not request disallowed product")

if __name__ == "__main__":
    unittest.main()
