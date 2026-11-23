"""The dashboard page. All views (monitor, alerts, energy) are one page driven by JS."""

from flask import Blueprint, current_app, render_template, url_for

from ..services import energy_optimization
from ..services.readings_client import ReadingsClient

bp = Blueprint("pages", __name__)


@bp.get("/")
def index():
    cfg = current_app.config
    client_config = {
        "readings_url": url_for("api.readings"),
        "websocket_url": cfg["WEBSOCKET_URL"]
        or ReadingsClient(cfg["SCRAPER_URL"], timeout=cfg["SCRAPER_TIMEOUT"]).websocket_url,
        "energy_live_url": url_for("energy.live"),
        "energy_poll_interval_ms": cfg["ENERGY_POLL_INTERVAL_MS"],
        "energy_suggestions_url": url_for("energy.suggestions"),
        "optimization_enabled": energy_optimization.is_enabled(cfg),
    }
    return render_template("index.html", client_config=client_config)
