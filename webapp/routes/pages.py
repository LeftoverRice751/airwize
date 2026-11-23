"""The dashboard page. All views (monitor, alerts) are one page driven by JS."""

from flask import Blueprint, current_app, render_template, url_for

bp = Blueprint("pages", __name__)


@bp.get("/")
def index():
    # The browser reads these from data attributes; see static/js/app.js.
    client_config = {
        "readings_url": url_for("api.readings"),
        "solar_forecast_url": url_for("api.solar_forecast"),
        "poll_interval_ms": current_app.config["POLL_INTERVAL_MS"],
    }
    return render_template("index.html", client_config=client_config)
