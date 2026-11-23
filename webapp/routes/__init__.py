"""HTTP routes. Handlers stay thin and delegate to ``webapp.services``."""

from flask import Flask

from .api import bp as api_bp
from .pages import bp as pages_bp


def register_blueprints(app: Flask) -> None:
    app.register_blueprint(pages_bp)
    app.register_blueprint(api_bp)
