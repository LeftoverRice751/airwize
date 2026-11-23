"""Tests for the Flask web app. They run against a local fake of the Go
scraper's API (tests/fake_scraper.py), never against Plume Labs.

    venv/bin/python -m unittest discover -s tests -v
"""

import json
import re
import socket
import unittest
from pathlib import Path

from tests.fake_scraper import FakeScraper, load_fixture, rebased_snapshot
from webapp import create_app
from webapp.services.readings_client import ReadingsClient, ScraperTimeout, ScraperUnavailable

ROOT = Path(__file__).resolve().parent.parent


def free_port() -> int:
    """A port with nothing listening on it, for "scraper is down" cases."""
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def make_app(scraper_url: str, timeout: float = 2.0):
    return create_app({"TESTING": True, "SCRAPER_URL": scraper_url, "SCRAPER_TIMEOUT": timeout})


class ReadingsClientTests(unittest.TestCase):
    def test_returns_scraper_body_unchanged(self):
        body = json.dumps({"province": "Laguna", "updated_at": None, "municipalities": []}).encode()
        with FakeScraper(body=body) as fake:
            got, ctype = ReadingsClient(fake.url, timeout=2).fetch_readings()
        self.assertEqual(got, body)
        self.assertIn("application/json", ctype)

    def test_unreachable_scraper(self):
        with self.assertRaises(ScraperUnavailable) as cm:
            ReadingsClient(f"http://127.0.0.1:{free_port()}", timeout=2).fetch_readings()
        self.assertNotIsInstance(cm.exception, ScraperTimeout)
        self.assertIn("could not be reached", str(cm.exception))

    def test_timeout(self):
        with FakeScraper(delay=1.0) as fake, self.assertRaises(ScraperTimeout):
            ReadingsClient(fake.url, timeout=0.2).fetch_readings()

    def test_error_status(self):
        with FakeScraper(status=500) as fake, self.assertRaises(ScraperUnavailable) as cm:
            ReadingsClient(fake.url, timeout=2).fetch_readings()
        self.assertIn("answered 500", str(cm.exception))

    def test_non_json(self):
        with FakeScraper(body=b"<html>not the scraper</html>") as fake, self.assertRaises(ScraperUnavailable):
            ReadingsClient(fake.url, timeout=2).fetch_readings()

    def test_trailing_slash_in_base_url(self):
        self.assertEqual(ReadingsClient("http://localhost:8080/").readings_url, "http://localhost:8080/api/readings")


class ReadingsProxyTests(unittest.TestCase):
    def test_proxy_forwards_snapshot(self):
        body = json.dumps(rebased_snapshot()).encode()
        with FakeScraper(body=body) as fake:
            resp = make_app(fake.url).test_client().get("/api/readings")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.data, body)  # byte for byte: the schema is the Go scraper's
        self.assertEqual(resp.headers["Cache-Control"], "no-store")
        self.assertEqual(resp.mimetype, "application/json")

    def test_first_pass_pending_is_passed_through(self):
        with FakeScraper(mode="pending") as fake:
            data = make_app(fake.url).test_client().get("/api/readings").get_json()
        self.assertIsNone(data["updated_at"])
        self.assertEqual(data["municipalities"], [])

    def test_partial_failure_message_is_passed_through(self):
        with FakeScraper(mode="partial") as fake:
            data = make_app(fake.url).test_client().get("/api/readings").get_json()
        self.assertIn("status 503", data["error"])
        self.assertTrue(data["municipalities"])

    def test_scraper_down_gives_502(self):
        resp = make_app(f"http://127.0.0.1:{free_port()}").test_client().get("/api/readings")
        self.assertEqual(resp.status_code, 502)
        self.assertIn("could not be reached", resp.get_json()["error"])
        self.assertEqual(resp.headers["Cache-Control"], "no-store")

    def test_scraper_timeout_gives_504(self):
        with FakeScraper(delay=1.0) as fake:
            resp = make_app(fake.url, timeout=0.2).test_client().get("/api/readings")
        self.assertEqual(resp.status_code, 504)
        self.assertIn("did not answer", resp.get_json()["error"])


class PageTests(unittest.TestCase):
    def setUp(self):
        self.client = make_app(f"http://127.0.0.1:{free_port()}").test_client()

    def test_dashboard_renders_without_scraper(self):
        resp = self.client.get("/")
        self.assertEqual(resp.status_code, 200)
        html = resp.get_data(as_text=True)
        self.assertIn("<title>Laguna AirWize</title>", html)
        self.assertIn('id="view-monitor"', html)
        self.assertIn('id="view-alerts"', html)
        cfg = json.loads(re.search(r'<script type="application/json" id="client-config">(.*?)</script>', html).group(1))
        self.assertEqual(cfg["readings_url"], "/api/readings")
        self.assertEqual(cfg["poll_interval_ms"], 60_000)

    def test_every_referenced_asset_is_served(self):
        html = self.client.get("/").get_data(as_text=True)
        assets = re.findall(r'(?:href|src)="(/static/[^"]+)"', html)
        self.assertGreaterEqual(len(assets), 5)
        for path in assets:
            with self.subTest(path=path):
                self.assertEqual(self.client.get(path).status_code, 200)

    def test_js_imports_resolve(self):
        """Every relative ES module import points at a file that exists."""
        js_root = ROOT / "dashboard" / "static" / "js"
        for f in js_root.rglob("*.js"):
            for spec in re.findall(r"""from\s+['"](\.[^'"]+)['"]""", f.read_text(encoding="utf-8")):
                with self.subTest(file=str(f.relative_to(js_root)), spec=spec):
                    self.assertTrue((f.parent / spec).resolve().is_file())

    def test_icons_used_in_js_exist_in_sprite(self):
        sprite = (ROOT / "dashboard" / "templates" / "partials" / "icons.html").read_text(encoding="utf-8")
        defined = set(re.findall(r"'([a-z]+)': 'M", sprite))
        used = set()
        for f in (ROOT / "dashboard").rglob("*"):
            if f.suffix in {".js", ".html"}:
                text = f.read_text(encoding="utf-8")
                used |= set(re.findall(r"""\bicon\(\s*['"]([a-z]+)['"]""", text))
                used |= set(re.findall(r"""iconName:\s*'([a-z]+)'""", text))
                used |= set(re.findall(r"""icon:\s*(?:dark \? )?'([a-z]+)'""", text))
        self.assertTrue(used)
        self.assertLessEqual(used, defined)


class SchemaTests(unittest.TestCase):
    """Keeps the test fixture honest against the Go structs it imitates."""

    @staticmethod
    def go_fields(struct: str) -> set[str]:
        src = (ROOT / "webscraper" / "main.go").read_text(encoding="utf-8")
        body = re.search(r"type %s struct \{(.*?)\n\}" % struct, src, re.S).group(1)
        return set(re.findall(r'json:"([a-z_]+)', body))

    def test_fixture_matches_go_snapshot(self):
        snap = load_fixture()
        self.assertLessEqual(set(snap), self.go_fields("Snapshot"))
        self.assertGreaterEqual(set(snap), self.go_fields("Snapshot") - {"error"})  # error is omitempty

    def test_fixture_matches_go_air_quality(self):
        for m in load_fixture()["municipalities"]:
            self.assertEqual(set(m), self.go_fields("AirQuality"))
            for p in m["forecast"]:
                self.assertEqual(set(p), self.go_fields("ForecastPoint"))


if __name__ == "__main__":
    unittest.main()
