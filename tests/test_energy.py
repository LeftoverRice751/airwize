"""Energy tab endpoints. No real device is contacted: adapters are fakes
registered only for the duration of a test."""

import json
import re
import unittest
from datetime import datetime, timezone
from unittest import mock

from webapp import create_app
from webapp.services import energy_device, energy_optimization
from webapp.services.energy_device import DeviceError, DeviceUnavailable, EnergyReading


def make_app(**overrides):
    cfg = {"TESTING": True, "SCRAPER_URL": "http://127.0.0.1:9", "WEBSOCKET_URL": None, "ENERGY_DEVICE_ADAPTER": "", "ENERGY_OPTIMIZER": ""}
    cfg.update(overrides)
    return create_app(cfg)


class FakeDevice:
    source = "Test module at 192.0.2.10"

    def __init__(self, result):
        self.result = result

    def read(self, timeout):
        if isinstance(self.result, Exception):
            raise self.result
        return self.result


def with_adapter(result):
    return mock.patch.dict(energy_device.ADAPTERS, {"fake": lambda cfg: FakeDevice(result)})


class LiveEnergyTests(unittest.TestCase):
    def get(self, **cfg):
        resp = make_app(**cfg).test_client().get("/api/energy/live")
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.headers["Cache-Control"], "no-store")
        return resp.get_json()

    def test_not_configured_by_default(self):
        data = self.get()
        self.assertEqual(data["state"], "not_configured")
        self.assertIsNone(data["reading"])
        self.assertIn("not been implemented", data["message"])

    def test_unknown_adapter_is_an_error(self):
        data = self.get(ENERGY_DEVICE_ADAPTER="no-such-module")
        self.assertEqual(data["state"], "error")
        self.assertIsNone(data["reading"])

    def test_connected_reading_passes_through_without_filling_gaps(self):
        at = datetime(2026, 11, 23, 5, 0, tzinfo=timezone.utc)
        with with_adapter(EnergyReading(charge_pct=64.0, load_w=820.0, measured_at=at)):
            data = self.get(ENERGY_DEVICE_ADAPTER="fake")
        self.assertEqual(data["state"], "connected")
        self.assertEqual(data["source"], FakeDevice.source)
        self.assertEqual(data["reading"]["charge_pct"], 64.0)
        self.assertEqual(data["reading"]["measured_at"], "2026-11-23T05:00:00Z")
        for missing in ("voltage_v", "solar_w", "generator_w"):
            self.assertIsNone(data["reading"][missing], missing)

    def test_unreachable_device_is_disconnected(self):
        with with_adapter(DeviceUnavailable("No answer from 192.0.2.10")):
            data = self.get(ENERGY_DEVICE_ADAPTER="fake")
        self.assertEqual(data["state"], "disconnected")
        self.assertIsNone(data["reading"])
        self.assertIn("No answer", data["message"])

    def test_bad_answer_is_an_error(self):
        with with_adapter(DeviceError("Unexpected payload")):
            data = self.get(ENERGY_DEVICE_ADAPTER="fake")
        self.assertEqual(data["state"], "error")
        self.assertIsNone(data["reading"])

    def test_adapter_must_return_a_reading(self):
        with with_adapter({"charge_pct": 50}):
            data = self.get(ENERGY_DEVICE_ADAPTER="fake")
        self.assertEqual(data["state"], "error")


class SuggestionsTests(unittest.TestCase):
    def test_placeholder_returns_no_suggestions(self):
        resp = make_app().test_client().post("/api/energy/suggestions", json={"site_type": "solar"})
        self.assertEqual(resp.status_code, 200)
        self.assertEqual(resp.get_json()["status"], "not_configured")
        self.assertEqual(resp.get_json()["suggestions"], [])

    def test_rejects_non_object(self):
        resp = make_app().test_client().post("/api/energy/suggestions", json=[1, 2])
        self.assertEqual(resp.status_code, 400)

    def test_registered_provider_is_used(self):
        class Provider:
            def suggest(self, context):
                return [energy_optimization.Suggestion(title=f"For {context['site_type']}", body="Example")]

        with mock.patch.dict(energy_optimization.PROVIDERS, {"fake-ai": lambda cfg: Provider()}):
            resp = make_app(ENERGY_OPTIMIZER="fake-ai").test_client().post("/api/energy/suggestions", json={"site_type": "grid"})
        self.assertEqual(resp.get_json(), {"status": "ok", "suggestions": [{"title": "For grid", "body": "Example"}], "message": None})


class EnergyPageTests(unittest.TestCase):
    def config(self, app):
        html = app.test_client().get("/").get_data(as_text=True)
        self.assertIn('id="view-energy"', html)
        self.assertIn('data-view="energy"', html)
        self.assertIn("Why is it behaving this way?", html)
        return json.loads(re.search(r'id="client-config">(.*?)</script>', html).group(1))

    def test_page_exposes_energy_endpoints_but_no_secrets(self):
        cfg = self.config(make_app())
        self.assertEqual(cfg["energy_live_url"], "/api/energy/live")
        self.assertEqual(cfg["energy_suggestions_url"], "/api/energy/suggestions")
        self.assertFalse(cfg["optimization_enabled"])
        self.assertFalse(any("key" in k.lower() for k in cfg))

    def test_optimization_enabled_only_with_registered_provider(self):
        self.assertFalse(self.config(make_app(ENERGY_OPTIMIZER="missing"))["optimization_enabled"])
        with mock.patch.dict(energy_optimization.PROVIDERS, {"fake-ai": lambda cfg: None}):
            self.assertTrue(self.config(make_app(ENERGY_OPTIMIZER="fake-ai"))["optimization_enabled"])


if __name__ == "__main__":
    unittest.main()
