"""The dashboard page. All views (monitor, alerts) are one page driven by JS."""

from flask import Blueprint, current_app, render_template, url_for

from ..services.readings_client import ReadingsClient

bp = Blueprint("pages", __name__)


@bp.get("/")
def index():
    cfg = current_app.config
    client_config = {
        "readings_url": url_for("api.readings"),
<<<<<<< HEAD
        "solar_forecast_url": url_for("api.solar_forecast"),
        "poll_interval_ms": current_app.config["POLL_INTERVAL_MS"],
=======
        "websocket_url": cfg["WEBSOCKET_URL"]
        or ReadingsClient(cfg["SCRAPER_URL"], timeout=cfg["SCRAPER_TIMEOUT"]).websocket_url,
>>>>>>> 5a4dc0d4d786c952be36c5004444c01688e3dcee
    }
    return render_template("index.html", client_config=client_config)
