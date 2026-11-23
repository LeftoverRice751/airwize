"""Tests for the baseline and AQI-augmented forecast models."""

import unittest
from datetime import datetime, timedelta, timezone

from tests.solar_fixtures import MANILA, hourly, municipality, snapshot
from webapp.services.forecast import forecast_next_24h, hour_of_day, train_models
from webapp.services.solar_sim import build_paired_dataset

NOW = datetime(2026, 11, 23, 10, 0, tzinfo=MANILA)
PATTERN = [8, 52, 18, 74, 12, 61, 25, 88]


def make_snapshot(current_pm25=20.0, future_pm25=90.0, with_pm25=True):
    past = [PATTERN[i % len(PATTERN)] for i in range(48)]
    points = hourly(NOW, past)
    if with_pm25:
        points += [(NOW + timedelta(hours=h), future_pm25) for h in range(1, 25)]
    else:
        points = []
    m = municipality("Calamba", current_pm25 if with_pm25 else None, NOW, points)
    return snapshot(NOW, [m])


class TrainModelsTests(unittest.TestCase):
    def test_models_fit_with_varying_pm25(self):
        models = train_models(build_paired_dataset(make_snapshot(), now=NOW))
        self.assertFalse(models["degraded"])
        self.assertIn("baseline", models)
        self.assertIn("aqi", models)
        self.assertGreaterEqual(models["trained_on"], 12)

    def test_degraded_when_pm25_is_missing(self):
        rows = build_paired_dataset(make_snapshot(with_pm25=False), now=NOW)
        self.assertTrue(all(r["pm25"] is None for r in rows))
        models = train_models(rows)
        self.assertTrue(models["degraded"])


class ForecastTests(unittest.TestCase):
    def setUp(self):
        self.snapshot = make_snapshot()
        self.rows = build_paired_dataset(self.snapshot, now=NOW)
        self.models = train_models(self.rows)
        self.forecast = forecast_next_24h(self.models, self.snapshot, now=NOW)

    def test_horizon_shape_and_order(self):
        self.assertEqual(len(self.forecast), 24)
        stamps = [datetime.strptime(r["timestamp"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc) for r in self.forecast]
        self.assertEqual(stamps[0], NOW.astimezone(timezone.utc))
        self.assertTrue(all(b - a == timedelta(hours=1) for a, b in zip(stamps, stamps[1:])))
        self.assertEqual(set(self.forecast[0]), {"timestamp", "baseline_kw", "aqi_kw", "delta_pct", "pm25", "cloudiness"})

    def test_both_models_are_zero_at_night(self):
        for row in self.forecast:
            ts = datetime.strptime(row["timestamp"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            local_hour = hour_of_day(ts)
            if local_hour <= 6 or local_hour >= 18:
                with self.subTest(hour=local_hour):
                    self.assertEqual(row["baseline_kw"], 0.0)
                    self.assertEqual(row["aqi_kw"], 0.0)
                    self.assertEqual(row["delta_pct"], 0.0)

    def test_aqi_forecast_is_lower_on_a_high_pm25_day(self):
        checked = 0
        for row in self.forecast:
            ts = datetime.strptime(row["timestamp"], "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)
            local_hour = hour_of_day(ts)
            if 8 <= local_hour <= 16 and row["baseline_kw"] > 0.05 and (row["pm25"] or 0) >= 80:
                with self.subTest(timestamp=row["timestamp"], baseline=row["baseline_kw"], aqi=row["aqi_kw"]):
                    self.assertLess(row["aqi_kw"], row["baseline_kw"])
                    self.assertLess(row["delta_pct"], 0)
                checked += 1
        self.assertGreater(checked, 0)

    def test_delta_pct_matches_the_two_columns(self):
        for row in self.forecast:
            if row["baseline_kw"] > 1e-9:
                expected = (row["aqi_kw"] - row["baseline_kw"]) / row["baseline_kw"] * 100
                self.assertAlmostEqual(row["delta_pct"], round(expected, 2), places=2)
            else:
                self.assertEqual(row["delta_pct"], 0.0)

    def test_values_are_clamped_to_peak(self):
        from webapp.services.solar_sim import peak_kw

        for row in self.forecast:
            for key in ("baseline_kw", "aqi_kw"):
                self.assertGreaterEqual(row[key], 0.0)
                self.assertLessEqual(row[key], peak_kw())

    def test_degraded_falls_back_to_baseline(self):
        snapshot_ = make_snapshot(with_pm25=False)
        models = train_models(build_paired_dataset(snapshot_, now=NOW))
        rows = forecast_next_24h(models, snapshot_, now=NOW)
        self.assertTrue(models["degraded"])
        self.assertTrue(all(r["baseline_kw"] == r["aqi_kw"] for r in rows))
        self.assertTrue(all(r["pm25"] is None for r in rows))

    def test_future_pm25_comes_from_the_real_forecast(self):
        self.assertEqual(self.forecast[0]["pm25"], 20.0)  # the measured reading at the first hour
        self.assertTrue(all(r["pm25"] == 90.0 for r in self.forecast[1:]))


class HourFeatureTests(unittest.TestCase):
    def test_hour_is_manila_local(self):
        self.assertEqual(hour_of_day("2026-11-23T04:00:00Z"), 12.0)  # noon in Manila
        self.assertEqual(hour_of_day("2026-11-23T16:30:00Z"), 0.5)  # 00:30 next day


if __name__ == "__main__":
    unittest.main()
