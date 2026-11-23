"""Energy tab endpoints. Handlers stay thin; see webapp/services/energy_*.py.

``GET /api/energy/live``          one reading from the solar system's Wi-Fi module
``POST /api/energy/suggestions``  future AI optimization suggestions (placeholder)

Simulation-only mode needs neither: its scripted data lives in the browser
(dashboard/static/js/lib/energy/).
"""

from flask import Blueprint, current_app, jsonify, request

from ..services import energy_device, energy_optimization

bp = Blueprint("energy", __name__, url_prefix="/api/energy")


@bp.get("/live")
def live():
    result = energy_device.poll_device(current_app.config)
    if result["state"] in {"disconnected", "error"}:
        current_app.logger.warning("energy device: %s", result["message"])
    resp = jsonify(result)
    resp.headers["Cache-Control"] = "no-store"
    return resp


@bp.post("/suggestions")
def suggestions():
    context = request.get_json(silent=True)
    if not isinstance(context, dict):
        return jsonify(status="error", suggestions=[], message="Expected a JSON object."), 400
    return jsonify(energy_optimization.suggest(current_app.config, context))
