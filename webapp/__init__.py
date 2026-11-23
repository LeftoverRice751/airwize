"""Flask application factory.

Templates and static files live in ``dashboard/`` so all front-end code sits
in one folder, while this package holds only server-side Python.
"""

from pathlib import Path

from flask import Flask

from config import Config

DASHBOARD_DIR = Path(__file__).resolve().parent.parent / "dashboard"


def create_app(config: type | dict | None = None) -> Flask:
    """Build the app. ``config`` overrides settings, e.g. in tests."""
    app = Flask(
        __name__,
        template_folder=str(DASHBOARD_DIR / "templates"),
        static_folder=str(DASHBOARD_DIR / "static"),
    )
    app.config.from_object(Config)
    if isinstance(config, dict):
        app.config.update(config)
    elif config is not None:
        app.config.from_object(config)

    from .routes import register_blueprints

    register_blueprints(app)
    return app
