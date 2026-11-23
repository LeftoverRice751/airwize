"""Tests for the grounded smart planner and the optional LLM polish."""

import json
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from tests.fake_scraper import FakeScraper
from webapp.services import ai_advisor
from webapp.services.solar_outlook import build_outlook, fetch_snapshot


def config(scraper_url: str, **overrides) -> dict:
    cfg = {
        "SCRAPER_URL": scraper_url,
        "SCRAPER_TIMEOUT": 2.0,
        "AIRWIZE_SOLAR_SITE_NAME": "demo-laguna-site",
        "AIRWIZE_PM25_HIGH": 35.0,
        "AIRWIZE_PM25_CRITICAL": 75.0,
        "ADVISOR": "smart",
        "AI_API_KEY": "",
        "AI_BASE_URL": "https://api.openai.com/v1",
        "AI_MODEL": "test-model",
        "AI_TIMEOUT": 2.0,
        "AI_CACHE_SECONDS": 300,
    }
    cfg.update(overrides)
    return cfg


class FakeLLM:
    """Tiny OpenAI-compatible endpoint that returns a canned chat completion."""

    def __init__(self, content: dict | None = None, status: int = 200):
        self.content = content
        self.status = status
        self.requests: list[dict] = []
        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), self._handler())
        self.httpd.daemon_threads = True

    @property
    def base_url(self) -> str:
        return f"http://127.0.0.1:{self.httpd.server_address[1]}/v1"

    def _handler(self):
        fake = self

        class Handler(BaseHTTPRequestHandler):
            def do_POST(self):  # noqa: N802
                length = int(self.headers.get("Content-Length", "0"))
                fake.requests.append(json.loads(self.rfile.read(length) or b"{}"))
                if fake.status != 200:
                    self.send_error(fake.status)
                    return
                content = json.dumps(fake.content or {})
                body = json.dumps({"choices": [{"message": {"content": content}}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def log_message(self, *args):
                pass

        return Handler

    def __enter__(self):
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()
        return self

    def __exit__(self, *exc):
        self.httpd.shutdown()
        self.httpd.server_close()


class SmartAdvisorTests(unittest.TestCase):
    def setUp(self):
        ai_advisor._CACHE.clear()
        self.fake = FakeScraper(scenario="hazy")
        self.fake.__enter__()
        self.cfg = config(self.fake.url)
        self.snapshot = fetch_snapshot(self.cfg)

    def tearDown(self):
        self.fake.__exit__(None, None, None)

    def test_hazy_air_produces_a_quantified_maintenance_plan(self):
        outlook = build_outlook(self.snapshot, "demo-laguna-site", self.cfg)
        self.assertEqual(outlook["advisor"]["mode"], "smart")
        self.assertEqual(outlook["advisor"]["label"], "Smart plan")
        solar = [r for r in outlook["recommendations"] if r["category"] == "solar"]
        self.assertTrue(solar)
        cleaning = next(r for r in solar if r["evidence"].get("action") == "clean_panels")
        evidence = cleaning["evidence"]
        self.assertGreater(evidence["estimated_recovery_kwh_day"], 0)
        self.assertGreater(evidence["pm25_max"], 35)
        self.assertIn("window_start", evidence)
        self.assertIn("maintenance", evidence)
        self.assertIn("kWh", cleaning["text"])
        self.assertIn("Clean", cleaning["text"])
        self.assertIn(cleaning["severity"], {"info", "warn"})

        # The demo clock needs frames whose advice actually changes (day vs night,
        # and as the remaining horizon shrinks).
        frame_actions = {tuple(r["evidence"].get("action") for r in f["recommendations"]) for f in outlook["simulation"]}
        self.assertEqual(len(outlook["simulation"]), 24)
        self.assertGreater(len(frame_actions), 1)

    def test_clean_air_has_no_solar_maintenance_action(self):
        with FakeScraper(scenario="clear") as fake:
            cfg = config(fake.url)
            outlook = build_outlook(fetch_snapshot(cfg), "demo-laguna-site", cfg)
        self.assertEqual([r for r in outlook["recommendations"] if r["category"] == "solar"], [])

    def test_ai_without_a_key_falls_back_to_the_planner(self):
        cfg = config(self.fake.url, ADVISOR="ai", AI_API_KEY="")
        outlook = build_outlook(self.snapshot, "demo-laguna-site", cfg)
        self.assertEqual(outlook["advisor"]["mode"], "smart")
        self.assertTrue(outlook["advisor"]["fallback"])

    def test_rules_mode_keeps_the_old_label(self):
        cfg = config(self.fake.url, ADVISOR="rules")
        outlook = build_outlook(self.snapshot, "demo-laguna-site", cfg)
        self.assertEqual(outlook["advisor"]["mode"], "rules")
        self.assertEqual(outlook["advisor"]["label"], "Rules, not a model")


class LLMAdvisorTests(unittest.TestCase):
    def setUp(self):
        ai_advisor._CACHE.clear()
        self.fake = FakeScraper(scenario="hazy")
        self.fake.__enter__()
        outlook = build_outlook(self.snapshot(), "demo-laguna-site", config(self.fake.url))
        self.forecast = outlook["forecast"]
        self.snapshot_data = self.snapshot()

    def tearDown(self):
        self.fake.__exit__(None, None, None)

    def snapshot(self) -> dict:
        return fetch_snapshot(config(self.fake.url))

    def test_llm_rewrites_and_reorders_grounded_candidates(self):
        with FakeLLM(
            content={
                "suggestions": [
                    {
                        "id": "shift_loads",
                        "text": "Move heavy loads out of the hazy window and pre-charge before it starts.",
                        "severity": "warn",
                    },
                    {
                        "id": "clean_panels",
                        "text": "Rinse the panels in the cleanest daylight block to recover the haze loss.",
                        "severity": "info",
                    },
                ]
            }
        ) as llm:
            cfg = config(self.fake.url, ADVISOR="ai", AI_API_KEY="test-key", AI_BASE_URL=llm.base_url)
            recs, advisor = ai_advisor.advise(self.snapshot_data, self.forecast, "demo-laguna-site", cfg)
        self.assertEqual(advisor["mode"], "ai")
        self.assertEqual(advisor["label"], "AI advisor")
        self.assertEqual([r["text"] for r in recs][:2], [
            "Move heavy loads out of the hazy window and pre-charge before it starts.",
            "Rinse the panels in the cleanest daylight block to recover the haze loss.",
        ])
        self.assertEqual(recs[0]["severity"], "warn")
        self.assertEqual(recs[0]["category"], "solar")
        self.assertIn("action", recs[0]["evidence"])
        self.assertEqual(len(llm.requests), 1)
        self.assertEqual(llm.requests[0]["model"], "test-model")

    def test_llm_failure_falls_back_to_the_planner(self):
        with FakeLLM(status=500) as llm:
            cfg = config(self.fake.url, ADVISOR="ai", AI_API_KEY="test-key", AI_BASE_URL=llm.base_url)
            recs, advisor = ai_advisor.advise(self.snapshot_data, self.forecast, "demo-laguna-site", cfg)
        self.assertEqual(advisor["mode"], "smart")
        self.assertTrue(advisor["fallback"])
        self.assertTrue(any(r["evidence"].get("action") == "clean_panels" for r in recs))

    def test_invalid_llm_output_falls_back(self):
        with FakeLLM(content={"suggestions": [{"id": "not-a-candidate", "text": "Invented action"}]}) as llm:
            cfg = config(self.fake.url, ADVISOR="ai", AI_API_KEY="test-key", AI_BASE_URL=llm.base_url)
            recs, advisor = ai_advisor.advise(self.snapshot_data, self.forecast, "demo-laguna-site", cfg)
        self.assertEqual(advisor["mode"], "smart")
        self.assertTrue(recs)


if __name__ == "__main__":
    unittest.main()
