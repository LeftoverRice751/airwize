"""The Solar outlook: synthetic 24-hour solar forecast plus the grounded
advisor plan, built from one Go scraper snapshot.

Shared by ``GET /api/solar-forecast`` (the Outlook card) and the Energy tab's
suggestions provider (webapp/services/energy_optimization.py), so both always
show the same advice. Generation is synthetic; the PM2.5 input is real Plume
Labs data forwarded by the scraper. The advisor is deterministic unless an LLM
is configured in ``webapp/services/ai_advisor.py``.
"""

from __future__ import annotations

import json
from collections.abc import Mapping
from datetime import datetime, timezone
from typing import Any

from .ai_advisor import advise
from .forecast import forecast_next_24h, train_models
from .readings_client import ReadingsClient
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


def _simulation_frames(snapshot: dict, forecast: list[dict], site_name: str, cfg: Mapping[str, Any] | None) -> list[dict]:
    """Precompute one advisor frame per forecast hour for the Outlook demo clock.

    The demo clock in the browser cycles these frames. Each frame moves the
    observation time and the focus municipality's PM2.5 to that hour, so the
    current output, the horizon and the advisor's maintenance advice all change.
    Frames use the deterministic planner even when a live AI key is configured:
    the demo should be reproducible and must not spend 24 model calls per page.
    """
    sim_cfg = dict(cfg) if cfg is not None else {}
    sim_cfg["ADVISOR"] = "smart"
    focus = focus_municipality(snapshot)
    base_municipalities = [dict(m) for m in snapshot.get("municipalities") or []]
    focus_index = next(
        (i for i, m in enumerate(base_municipalities) if focus is not None and m.get("city") == focus.get("city")),
        None,
    )
    frames: list[dict] = []
    for index, row in enumerate(forecast):
        timestamp = row.get("timestamp")
        pm25 = row.get("pm25")
        frame_snapshot = dict(snapshot)
        frame_snapshot["updated_at"] = timestamp
        municipalities = [dict(m) for m in base_municipalities]
        if focus_index is not None and pm25 is not None:
            focused = dict(municipalities[focus_index])
            focused["pollutants"] = {**(focused.get("pollutants") or {})}
            focused["pollutants"]["PM25"] = {"pi": pm25, "value_upm": pm25}
            focused["measured_at"] = timestamp
            municipalities[focus_index] = focused
        frame_snapshot["municipalities"] = municipalities
        recommendations, advisor = advise(
            frame_snapshot,
            forecast[index:],
            site_name,
            sim_cfg,
            focus_city=focus.get("city") if focus is not None else None,
        )
        frames.append(
            {
                "timestamp": timestamp,
                "current_kw": synthetic_generation(timestamp, row.get("cloudiness"), pm25),
                "pm25": pm25,
                "recommendations": recommendations,
                "advisor": advisor,
            }
        )
    return frames


def build_outlook(snapshot: dict, site_name: str, cfg: Mapping[str, Any] | None = None) -> dict:
    """Forecast plus advisor suggestions for ``snapshot``. Raises OutlookUnavailable."""
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
    recommendations, advisor = advise(snapshot, forecast, site_name, cfg)
    return {
        "generated_at": iso_z(datetime.now(timezone.utc)),
        "site": site_name,
        "municipality": focus["city"],
        "province": snapshot.get("province"),
        "current_kw": synthetic_generation(now, cloudiness_for(now), pm25),
        "pm25": None if pm25 is None else round(pm25, 3),
        "peak_kw": peak_kw(),
        "forecast": forecast,
        "recommendations": recommendations,
        "advisor": advisor,
        "simulation": _simulation_frames(snapshot, forecast, site_name, cfg),
        "synthetic": True,
        "degraded": bool(models.get("degraded", False)),
    }
