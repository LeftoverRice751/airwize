"""JSON endpoints for the browser.

``GET /api/readings`` forwards the Go scraper's snapshot byte for byte, so the
schema is exactly the one defined by ``Snapshot`` in webscraper/main.go. When
the scraper cannot be reached, it answers 502 (or 504 on timeout) with
``{"error": "..."}`` and the dashboard shows its error state.

``GET /api/solar-forecast`` is the demo's synthetic-solar endpoint. It reads the
same snapshot through the same client, builds a paired PM2.5/solar dataset,
fits the baseline and AQI-augmented models, forecasts 24 hours and attaches the
rules-based recommendations. The generation is synthetic; the PM2.5 input is
real Plume Labs data forwarded by the scraper.
"""

import json
from datetime import datetime, timezone

from flask import Blueprint, Response, current_app, jsonify

from ..services.forecast import forecast_next_24h, train_models
from ..services.readings_client import ReadingsClient, ScraperTimeout, ScraperUnavailable
from ..services.recommendations import recommend
from ..services.solar_sim import (
    build_paired_dataset,
    cloudiness_for,
    focus_municipality,
    iso_z,
    municipality_pm25,
    observed_at,
    peak_kw,
    synthetic_generation,
)

bp = Blueprint("api", __name__, url_prefix="/api")


def _client() -> ReadingsClient:
    cfg = current_app.config
    return ReadingsClient(cfg["SCRAPER_URL"], timeout=cfg["SCRAPER_TIMEOUT"])


@bp.get("/readings")
def readings():
    try:
        body, content_type = _client().fetch_readings()
    except ScraperTimeout as exc:
        return _error(str(exc), 504)
    except ScraperUnavailable as exc:
        return _error(str(exc), 502)
    return Response(body, status=200, content_type=content_type, headers={"Cache-Control": "no-store"})


@bp.get("/solar-forecast")
def solar_forecast():
    """24-hour synthetic solar forecast plus rules-based recommendations."""
    try:
        body, _ = _client().fetch_readings()
    except ScraperTimeout as exc:
        return _error(str(exc), 504, source="solar forecast")
    except ScraperUnavailable as exc:
        return _error(str(exc), 502, source="solar forecast")

    try:
        snapshot = json.loads(body)
    except ValueError:
        return _error("The readings service did not return JSON.", 502, source="solar forecast")

    if not isinstance(snapshot, dict) or not snapshot.get("municipalities"):
        return _error(
            "The readings service has no municipalities yet; the scraper's first pass may still be running.",
            502,
            source="solar forecast",
        )

    try:
        now = observed_at(snapshot)
        rows = build_paired_dataset(snapshot, now=now)
        models = train_models(rows)
        forecast = forecast_next_24h(models, snapshot, now=now)
    except (ValueError, KeyError, TypeError) as exc:
        current_app.logger.warning("solar forecast could not use the snapshot: %s", exc)
        return _error(f"The readings snapshot could not be used for a solar forecast ({exc}).", 502, source="solar forecast")

    focus = focus_municipality(snapshot)
    pm25 = municipality_pm25(focus)
    payload = {
        "generated_at": iso_z(datetime.now(timezone.utc)),
        "site": current_app.config["AIRWIZE_SOLAR_SITE_NAME"],
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
    resp = jsonify(payload)
    resp.headers["Cache-Control"] = "no-store"
    return resp


def _error(message: str, status: int, source: str = "readings proxy"):
    current_app.logger.warning("%s: %s", source, message)
    resp = jsonify(error=message)
    resp.status_code = status
    resp.headers["Cache-Control"] = "no-store"
    return resp
