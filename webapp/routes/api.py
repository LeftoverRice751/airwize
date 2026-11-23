"""JSON endpoints for the browser.

``GET /api/readings`` forwards the Go scraper's snapshot byte for byte, so the
schema is exactly the one defined by ``Snapshot`` in webscraper/main.go. When
the scraper cannot be reached, it answers 502 (or 504 on timeout) with
``{"error": "..."}`` and the dashboard shows its error state.

``GET /api/solar-forecast`` is the demo's synthetic-solar endpoint. It reads the
same snapshot through the same client, builds a paired PM2.5/solar dataset,
fits the baseline and AQI-augmented models, forecasts 24 hours and attaches the
grounded advisor plan (smart planner, optionally polished by a configured LLM).
The generation is synthetic; the PM2.5 input is real Plume Labs data forwarded
by the scraper.
"""

from flask import Blueprint, Response, current_app, jsonify

from ..services.readings_client import ReadingsClient, ScraperTimeout, ScraperUnavailable
from ..services.solar_outlook import OutlookUnavailable, build_outlook, fetch_snapshot

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
    cfg = current_app.config
    try:
        payload = build_outlook(fetch_snapshot(cfg), cfg["AIRWIZE_SOLAR_SITE_NAME"], cfg)
    except ScraperTimeout as exc:
        return _error(str(exc), 504, source="solar forecast")
    except (ScraperUnavailable, OutlookUnavailable) as exc:
        return _error(str(exc), 502, source="solar forecast")
    resp = jsonify(payload)
    resp.headers["Cache-Control"] = "no-store"
    return resp


def _error(message: str, status: int, source: str = "readings proxy"):
    current_app.logger.warning("%s: %s", source, message)
    resp = jsonify(error=message)
    resp.status_code = status
    resp.headers["Cache-Control"] = "no-store"
    return resp
