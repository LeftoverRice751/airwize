"""The Solar outlook: synthetic 24-hour solar forecast plus rules-based
recommendations, built from one Go scraper snapshot.

Shared by ``GET /api/solar-forecast`` (the Solar outlook card) and the Energy
tab's "rules" suggestions provider (webapp/services/energy_optimization.py),
so both always show the same recommendations. Generation is synthetic; the
PM2.5 input is real Plume Labs data forwarded by the scraper.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any

from .forecast import forecast_next_24h, train_models
from .readings_client import ReadingsClient
from .recommendations import recommend
from .solar_sim import (
    build_paired_dataset,
    cloudiness_for,
    focus_municipality,
    iso_z,
    municipality_pm25,
    observed_at,
    peak_kw,
    synthetic_generation,
)


class OutlookUnavailable(Exception):
    """The snapshot cannot be turned into an outlook (not a scraper outage)."""


def fetch_snapshot(cfg: Mapping[str, Any]) -> dict:
    """Read the scraper's snapshot. Raises ScraperUnavailable/ScraperTimeout or OutlookUnavailable."""
    body, _ = ReadingsClient(cfg["SCRAPER_URL"], timeout=cfg["SCRAPER_TIMEOUT"]).fetch_readings()
    try:
        return json.loads(body)
    except ValueError as exc:
        raise OutlookUnavailable("The readings service did not return JSON.") from exc


def build_outlook(snapshot: dict, site_name: str) -> dict:
    """Forecast plus recommendations for ``snapshot``. Raises OutlookUnavailable."""
    if not isinstance(snapshot, dict) or not snapshot.get("municipalities"):
        raise OutlookUnavailable("The readings service has no municipalities yet; the scraper's first pass may still be running.")
    try:
        now = observed_at(snapshot)
        rows = build_paired_dataset(snapshot, now=now)
        models = train_models(rows)
        forecast = forecast_next_24h(models, snapshot, now=now)
    except (ValueError, KeyError, TypeError) as exc:
        raise OutlookUnavailable(f"The readings snapshot could not be used for a solar forecast ({exc}).") from exc

    focus = focus_municipality(snapshot)
    pm25 = municipality_pm25(focus)
    return {
        "generated_at": iso_z(datetime.now(timezone.utc)),
        "site": site_name,
        "municipality": focus["city"],
        "province": snapshot.get("province"),
        "current_kw": synthetic_generation(now, cloudiness_for(now), pm25),
        "pm25": None if pm25 is None else round(pm25, 3),
        "peak_kw": peak_kw(),
        "forecast": forecast,
        "recommendations": recommend(snapshot, forecast),
        "synthetic": True,
        "degraded": bool(models.get("degraded", False)),
    }
