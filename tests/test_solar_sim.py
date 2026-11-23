"""Tests for the synthetic solar module. No network, fixed clocks."""

import unittest
from datetime import datetime, timedelta

from tests.solar_fixtures import MANILA, hourly, municipality, snapshot
from webapp.services.solar_sim import (
    build_paired_dataset,
    cloudiness_for,
    focus_municipality,
    peak_kw,
    pollution_factor,
    synthetic_generation,
)

NOW = datetime(2026, 11, 23, 12, 0, tzinfo=MANILA)


def at(hour: int, minute: int = 0, day: int = 23) -> datetime:
    return datetime(2026, 11, day, hour, minute, tzinfo=MANILA)


class SyntheticGenerationTests(unittest.TestCase):
    def test_zero_at_night(self):
        for ts in (at(0), at(5), at(5, 59), at(18), at(19), at(23)):
            with self.subTest(ts=ts):
                self.assertEqual(synthetic_generation(ts, 0.0, 0.0), 0.0)

    def test_peaks_near_noon(self):
        noon = synthetic_generation(at(12), 0.0, 0.0)
        self.assertAlmostEqual(noon, peak_kw(), places=6)
        self.assertGreater(noon, synthetic_generation(at(9), 0.0, 0.0))
        self.assertGreater(noon, synthetic_generation(at(15), 0.0, 0.0))

    def test_clouds_reduce_output(self):
        clear = synthetic_generation(at(12), 0.0, 0.0)
        cloudy = synthetic_generation(at(12), 0.8, 0.0)
        self.assertLess(cloudy, clear)
        self.assertGreater(cloudy, 0.0)

    def test_pollution_reduces_output_monotonically(self):
        outputs = [synthetic_generation(at(12), 0.0, pm25) for pm25 in (0, 10, 30, 60, 100, 300)]
        self.assertEqual(outputs, sorted(outputs, reverse=True))
        self.assertLess(outputs[-1], outputs[0])

    def test_pollution_attenuation_floor(self):
        self.assertEqual(pollution_factor(0), 1.0)
        self.assertAlmostEqual(pollution_factor(1000), 0.6)
        self.assertGreaterEqual(pollution_factor(5000), 0.6)

    def test_cloudiness_is_deterministic_per_site_and_hour(self):
        self.assertEqual(cloudiness_for(NOW), cloudiness_for(NOW))
        self.assertEqual(cloudiness_for(NOW, site="site-a"), cloudiness_for(NOW, site="site-a"))
        self.assertNotEqual(cloudiness_for(NOW, site="site-a"), cloudiness_for(NOW + timedelta(hours=1), site="site-a"))
        self.assertGreaterEqual(cloudiness_for(NOW), 0.0)
        self.assertLessEqual(cloudiness_for(NOW), 0.85)


class PairedDatasetTests(unittest.TestCase):
    def setUp(self):
        # 48 hours of real-looking PM2.5 forecast points around the observation.
        points = hourly(NOW, [10 + (i % 5) * 4 for i in range(48)], start_hours_ago=47)
        points += [(NOW + timedelta(hours=h), 60.0) for h in range(1, 6)]
        self.m = municipality("Calamba", 18.0, NOW, points)
        self.snapshot = snapshot(NOW, [self.m])

    def test_dataset_shape_and_flags(self):
        rows = build_paired_dataset(self.snapshot, hours=48)
        self.assertEqual(len(rows), 48)
        for row in rows:
            self.assertEqual(
                set(row),
                {"timestamp", "municipality", "pm25", "cloudiness", "generation_kw", "synthetic"},
            )
            self.assertTrue(row["synthetic"])
            self.assertEqual(row["municipality"], "Calamba")
        self.assertTrue(rows[0]["timestamp"].endswith("Z"))

    def test_dataset_is_hourly_and_ends_now(self):
        rows = build_paired_dataset(self.snapshot, hours=6)
        from webapp.services.solar_sim import as_datetime

        stamps = [as_datetime(r["timestamp"]) for r in rows]
        self.assertEqual(stamps[-1], NOW.astimezone(stamps[-1].tzinfo))
        self.assertTrue(all(b - a == timedelta(hours=1) for a, b in zip(stamps, stamps[1:])))
        # Night hours in the synthetic series carry zero generation.
        for row, ts in zip(rows, stamps):
            self.assertEqual(synthetic_generation(ts, row["cloudiness"], row["pm25"]), row["generation_kw"])

    def test_dataset_is_reproducible(self):
        self.assertEqual(
            build_paired_dataset(self.snapshot, hours=12),
            build_paired_dataset(self.snapshot, hours=12),
        )

    def test_dataset_uses_real_pm25_when_available(self):
        rows = build_paired_dataset(self.snapshot, hours=4)
        self.assertEqual(rows[-1]["pm25"], 18.0)
        self.assertEqual(rows[-2]["pm25"], 14.0)
        # The forecast points ahead of now are real too (60 µg/m³ here).
        later = build_paired_dataset(snapshot(NOW + timedelta(hours=3), [self.m]), hours=1)
        self.assertEqual(later[-1]["pm25"], 60.0)

    def test_focus_prefers_worst_pm25_then_name(self):
        a = municipality("Alpha", 10.0, NOW)
        b = municipality("Beta", 55.0, NOW)
        c = municipality("Charlie", 10.0, NOW)
        self.assertEqual(focus_municipality(snapshot(NOW, [a, b, c]))["city"], "Beta")
        self.assertEqual(focus_municipality(snapshot(NOW, [c, a]))["city"], "Alpha")

    def test_empty_snapshot_is_rejected(self):
        with self.assertRaises(ValueError):
            build_paired_dataset({"municipalities": []})


if __name__ == "__main__":
    unittest.main()
