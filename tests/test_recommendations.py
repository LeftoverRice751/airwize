"""Tests for the rules-based recommendation engine."""

import unittest
from datetime import datetime, timedelta

from tests.solar_fixtures import MANILA, iso, municipality, snapshot
from webapp.services.recommendations import recommend

JUNE_MORNING = datetime(2026, 6, 15, 6, 30, tzinfo=MANILA)
JUNE_NOON = datetime(2026, 6, 15, 12, 0, tzinfo=MANILA)
JUNE_EVENING = datetime(2026, 6, 15, 18, 30, tzinfo=MANILA)
NOVEMBER_NOON = datetime(2026, 11, 15, 12, 0, tzinfo=MANILA)


def forecast(delta_pct: float = 0.0, hours: int = 24) -> list[dict]:
    start = JUNE_NOON.replace(minute=0, second=0, microsecond=0)
    rows = []
    for step in range(hours):
        rows.append(
            {
                "timestamp": iso(start + timedelta(hours=step)),
                "baseline_kw": 2.0,
                "aqi_kw": 2.0 * (1 + delta_pct / 100),
                "delta_pct": delta_pct,
                "pm25": 40.0,
                "cloudiness": 0.2,
            }
        )
    return rows


def hazy_snapshot(when: datetime, values=(50.0, 60.0), names=("Calamba", "Los Baños")):
    return snapshot(when, [municipality(name, value, when) for name, value in zip(names, values)])


def by_category(items, category):
    return [item for item in items if item["category"] == category]


class CleanAirTests(unittest.TestCase):
    def test_no_recommendations_on_a_clean_day(self):
        snap = snapshot(JUNE_NOON, [municipality("Calamba", 8.0, JUNE_NOON), municipality("Los Baños", 12.0, JUNE_NOON)])
        self.assertEqual(recommend(snap, forecast(0.0)), [])

    def test_clean_air_but_hazy_solar_still_gets_a_solar_note(self):
        snap = snapshot(JUNE_NOON, [municipality("Calamba", 8.0, JUNE_NOON)])
        items = recommend(snap, forecast(-7.0))
        self.assertEqual([i["category"] for i in items], ["solar"])
        self.assertEqual(items[0]["severity"], "info")


class PatrolTests(unittest.TestCase):
    def test_hazy_morning_recommends_patrol(self):
        items = recommend(hazy_snapshot(JUNE_MORNING), forecast(0.0))
        patrol = [i for i in items if i["category"] == "air" and "patrol" in i["text"]]
        self.assertEqual(len(patrol), 1)
        item = patrol[0]
        self.assertEqual(item["severity"], "warn")
        self.assertEqual(item["evidence"]["municipalities"], ["Calamba", "Los Baños"])
        self.assertEqual(item["evidence"]["local_hour"], 6)

    def test_one_hazy_municipality_is_not_enough_for_patrol(self):
        snap = snapshot(JUNE_MORNING, [municipality("Calamba", 60.0, JUNE_MORNING), municipality("Los Baños", 10.0, JUNE_MORNING)])
        self.assertEqual(by_category(recommend(snap, forecast(0.0)), "air"), [])

    def test_haze_outside_windows_does_not_recommend_patrol(self):
        items = recommend(hazy_snapshot(NOVEMBER_NOON), forecast(0.0))
        self.assertEqual([i for i in items if "patrol" in i["text"]], [])


class HarvestTests(unittest.TestCase):
    def test_hazy_harvest_month_recommends_straw_collection(self):
        items = by_category(recommend(hazy_snapshot(NOVEMBER_NOON), forecast(0.0)), "air")
        straw = [i for i in items if "rice-straw" in i["text"]]
        self.assertEqual(len(straw), 1)
        item = straw[0]
        self.assertEqual(item["severity"], "info")
        self.assertEqual(item["evidence"]["municipalities"], ["Calamba", "Los Baños"])
        self.assertEqual(item["evidence"]["month"], 11)
        self.assertIn("Pila", item["evidence"]["precedent"])

    def test_non_harvest_month_has_no_straw_advice(self):
        items = recommend(hazy_snapshot(JUNE_NOON), forecast(0.0))
        self.assertEqual([i for i in items if "rice-straw" in i["text"]], [])


class CookingTests(unittest.TestCase):
    def test_cooking_hours_recommend_clean_cooking(self):
        items = by_category(recommend(hazy_snapshot(JUNE_EVENING), forecast(0.0)), "air")
        cooking = [i for i in items if "clean cooking" in i["text"]]
        self.assertEqual(len(cooking), 1)
        self.assertEqual(cooking[0]["severity"], "info")
        self.assertEqual(cooking[0]["evidence"]["sdg"], "7.1.2")
        self.assertEqual(cooking[0]["evidence"]["municipalities"], ["Calamba", "Los Baños"])

    def test_industrial_source_suppresses_cooking_advice(self):
        snap = hazy_snapshot(JUNE_EVENING)
        snap["municipalities"][0]["dominant_source"] = "Industrial estate"
        items = by_category(recommend(snap, forecast(0.0)), "air")
        self.assertEqual([i for i in items if "clean cooking" in i["text"]], [])


class SolarRuleTests(unittest.TestCase):
    def test_high_haze_and_large_drop_recommends_cleaning(self):
        items = recommend(hazy_snapshot(JUNE_NOON), forecast(-20.0))
        solar = by_category(items, "solar")
        self.assertEqual(len(solar), 1)
        item = solar[0]
        self.assertEqual(item["severity"], "warn")
        self.assertIn("Cleaning", item["text"])
        self.assertEqual(item["evidence"]["municipalities"], ["Calamba", "Los Baños"])
        self.assertAlmostEqual(item["evidence"]["mean_delta_pct"], -20.0)
        # 20 % of 5 kW over 12 daylight hours = 12 kWh/day.
        self.assertAlmostEqual(item["evidence"]["estimated_recovery_kwh_day"], 12.0, places=2)

    def test_moderate_drop_recommends_shifting_loads(self):
        snap = snapshot(JUNE_NOON, [municipality("Calamba", 10.0, JUNE_NOON)])
        solar = by_category(recommend(snap, forecast(-7.0)), "solar")
        self.assertEqual(len(solar), 1)
        self.assertEqual(solar[0]["severity"], "info")
        self.assertIn("Pre-charge", solar[0]["text"])
        self.assertIn("window_start", solar[0]["evidence"])
        self.assertEqual(solar[0]["evidence"]["municipalities"], ["Calamba"])

    def test_small_drop_has_no_solar_recommendation(self):
        snap = snapshot(JUNE_NOON, [municipality("Calamba", 10.0, JUNE_NOON)])
        self.assertEqual(by_category(recommend(snap, forecast(-3.0)), "solar"), [])

    def test_missing_forecast_is_safe(self):
        self.assertEqual(by_category(recommend(hazy_snapshot(JUNE_NOON), []), "solar"), [])


if __name__ == "__main__":
    unittest.main()
