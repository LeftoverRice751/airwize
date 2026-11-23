"""End-to-end tests for GET /api/solar-forecast against the fake scraper."""

import json
import socket
import unittest

from tests.fake_scraper import FakeScraper, rebased_snapshot
from webapp import create_app


def free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def make_app(scraper_url: str, timeout: float = 2.0):
    return create_app({"TESTING": True, "SCRAPER_URL": scraper_url, "SCRAPER_TIMEOUT": timeout})


class SolarForecastEndpointTests(unittest.TestCase):
    def test_returns_the_documented_payload(self):
        with FakeScraper() as fake:
            resp = make_app(fake.url).test_client().get("/api/solar-forecast")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.mimetype, "application/json")
        self.assertEqual(resp.headers["Cache-Control"], "no-store")

        data = resp.get_json()
        self.assertTrue(data["synthetic"])
        self.assertEqual(data["site"], "demo-laguna-site")
        self.assertIsInstance(data["current_kw"], (int, float))
        self.assertGreaterEqual(data["current_kw"], 0.0)
        self.assertEqual(data["peak_kw"], 5.0)
        self.assertIsInstance(data["degraded"], bool)
        self.assertIsInstance(data["recommendations"], list)
        self.assertTrue(data["generated_at"].endswith("Z"))
        self.assertIn("province", data)

        fixture = rebased_snapshot()
        self.assertIn(data["municipality"], [m["city"] for m in fixture["municipalities"]])

        forecast = data["forecast"]
        self.assertEqual(len(forecast), 24)
        self.assertEqual(
            set(forecast[0]),
            {"timestamp", "baseline_kw", "aqi_kw", "delta_pct", "pm25", "cloudiness"},
        )
        stamps = [row["timestamp"] for row in forecast]
        self.assertEqual(stamps, sorted(stamps))
        for row in forecast:
            self.assertGreaterEqual(row["baseline_kw"], 0.0)
            self.assertGreaterEqual(row["aqi_kw"], 0.0)
            if row["baseline_kw"] > 0:
                expected = (row["aqi_kw"] - row["baseline_kw"]) / row["baseline_kw"] * 100
                self.assertAlmostEqual(row["delta_pct"], round(expected, 2), places=2)

        for item in data["recommendations"]:
            self.assertIn(item["category"], {"solar", "air"})
            self.assertIn(item["severity"], {"info", "warn"})
            self.assertIsInstance(item["text"], str)
            self.assertIsInstance(item["evidence"], dict)

    def test_degraded_snapshot_without_pm25(self):
        body = json.dumps(rebased_snapshot()).encode()
        snapshot = json.loads(body)
        for municipality in snapshot["municipalities"]:
            municipality["pollutants"].pop("PM25", None)
            for point in municipality.get("forecast") or []:
                (point.get("values") or {}).pop("PM25", None)
        with FakeScraper(body=json.dumps(snapshot).encode()) as fake:
            data = make_app(fake.url).test_client().get("/api/solar-forecast").get_json()
        self.assertTrue(data["degraded"])
        self.assertIsNone(data["pm25"])
        self.assertTrue(all(row["baseline_kw"] == row["aqi_kw"] for row in data["forecast"]))
        self.assertTrue(all(row["pm25"] is None for row in data["forecast"]))

    def test_scraper_error_gives_502(self):
        with FakeScraper(status=503) as fake:
            resp = make_app(fake.url).test_client().get("/api/solar-forecast")
        self.assertEqual(resp.status_code, 502)
        self.assertIn("answered 503", resp.get_json()["error"])
        self.assertEqual(resp.headers["Cache-Control"], "no-store")

    def test_unreachable_scraper_gives_502(self):
        # A reserved TLD that cannot resolve: a deterministic connection failure
        # (an unused localhost port can hang on Windows and become a 504).
        resp = make_app("http://nonexistent.invalid:8080").test_client().get("/api/solar-forecast")
        self.assertEqual(resp.status_code, 502)
        self.assertIn("could not be reached", resp.get_json()["error"])

    def test_scraper_timeout_gives_504(self):
        with FakeScraper(delay=1.0) as fake:
            resp = make_app(fake.url, timeout=0.2).test_client().get("/api/solar-forecast")
        self.assertEqual(resp.status_code, 504)
        self.assertIn("did not answer", resp.get_json()["error"])

    def test_first_pass_pending_gives_502(self):
        with FakeScraper(mode="pending") as fake:
            resp = make_app(fake.url).test_client().get("/api/solar-forecast")
        self.assertEqual(resp.status_code, 502)
        self.assertIn("no municipalities", resp.get_json()["error"])


class PageConfigTests(unittest.TestCase):
    def test_page_config_exposes_the_solar_endpoint_and_same_interval(self):
        client = make_app(f"http://127.0.0.1:{free_port()}").test_client()
        html = client.get("/").get_data(as_text=True)
        import re

        cfg = json.loads(re.search(r'<script type="application/json" id="client-config">(.*?)</script>', html).group(1))
        self.assertEqual(cfg["solar_forecast_url"], "/api/solar-forecast")
        self.assertEqual(cfg["poll_interval_ms"], 60_000)


if __name__ == "__main__":
    unittest.main()
