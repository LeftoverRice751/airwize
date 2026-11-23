"""JSON endpoints for the browser.

``GET /api/readings`` forwards the Go scraper's snapshot byte for byte, so the
schema is exactly the one defined by ``Snapshot`` in webscraper/main.go. When
the scraper cannot be reached, it answers 502 (or 504 on timeout) with
``{"error": "..."}`` and the dashboard shows its error state.
"""

from flask import Blueprint, Response, current_app, jsonify

from ..services.readings_client import ReadingsClient, ScraperTimeout, ScraperUnavailable

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


def _error(message: str, status: int):
    current_app.logger.warning("readings proxy: %s", message)
    resp = jsonify(error=message)
    resp.status_code = status
    resp.headers["Cache-Control"] = "no-store"
    return resp
